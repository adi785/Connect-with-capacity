"""Supabase Storage integration: signed upload/download URLs and upload validation.

The service-role key is used here and must never reach the frontend. Clients get
short-lived signed URLs instead.
"""

from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass

import httpx

from app.core.config import settings
from app.core.errors import AppError, BadRequest

logger = logging.getLogger(__name__)

# Allowed MIME types per learning-resource type (Section 11: type whitelisting).
ALLOWED_MIME_TYPES: dict[str, set[str]] = {
    "lecture_video": {"video/mp4", "video/webm", "video/quicktime", "video/x-matroska"},
    "presentation": {
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/pdf",
    },
    "document": {
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
        "text/markdown",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    "link": set(),  # links carry no file
}

IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
CERTIFICATE_MIME_TYPES = {"application/pdf", *IMAGE_MIME_TYPES}

_SAFE_SEGMENT = re.compile(r"[^A-Za-z0-9._-]+")


@dataclass(slots=True)
class SignedUpload:
    """A one-shot signed upload target handed to the client."""

    bucket: str
    path: str
    upload_url: str
    token: str | None = None


def _max_bytes_for(mime_type: str) -> int:
    if mime_type.startswith("video/"):
        return settings.max_upload_mb_video * 1024 * 1024
    if mime_type.startswith("image/"):
        return settings.max_upload_mb_image * 1024 * 1024
    return settings.max_upload_mb_document * 1024 * 1024


def sanitize_filename(filename: str) -> str:
    """Reduce a client-supplied filename to a safe single path segment."""
    name = (filename or "file").strip().replace("\\", "/").split("/")[-1]
    name = _SAFE_SEGMENT.sub("_", name).strip("._-")
    return name[:120] or "file"


def validate_upload(
    *,
    mime_type: str,
    size_bytes: int | None,
    allowed: set[str],
    label: str,
) -> None:
    """Reject anything outside the type whitelist or over the size ceiling."""
    normalized = (mime_type or "").lower().split(";")[0].strip()
    if normalized not in allowed:
        raise BadRequest(
            f"Unsupported content type '{mime_type}' for {label}. "
            f"Allowed: {', '.join(sorted(allowed)) or 'none'}",
            code="unsupported_media_type",
        )

    if size_bytes is not None:
        limit = _max_bytes_for(normalized)
        if size_bytes <= 0:
            raise BadRequest("File size must be greater than zero", code="invalid_size")
        if size_bytes > limit:
            raise AppError(
                413,
                f"File exceeds the {limit // (1024 * 1024)} MB limit for this type",
                code="payload_too_large",
            )


def build_object_path(*parts: str, filename: str) -> str:
    """Compose a collision-resistant object path inside a bucket."""
    safe_parts = [_SAFE_SEGMENT.sub("_", str(p)) for p in parts if p]
    return "/".join([*safe_parts, f"{uuid.uuid4().hex}-{sanitize_filename(filename)}"])


def _require_config() -> None:
    if not settings.supabase_url or not settings.effective_service_role_key:
        raise AppError(
            503,
            "File storage is not configured. Set SUPABASE_URL and either "
            "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY to enable uploads.",
            code="storage_unconfigured",
        )


def _headers() -> dict[str, str]:
    key = settings.effective_service_role_key
    headers = {"apikey": key}

    # Legacy service_role keys are JWTs and remain valid in Authorization.
    # New sb_secret keys are opaque API keys, not JWTs, so they must only be
    # sent through apikey or Supabase rejects the request as an invalid JWT.
    if settings.supabase_service_role_key:
        headers["Authorization"] = f"Bearer {settings.supabase_service_role_key}"

    return headers


def _storage_base() -> str:
    return f"{settings.supabase_url.rstrip('/')}/storage/v1"


async def create_signed_upload_url(bucket: str, path: str) -> SignedUpload:
    """Ask Supabase for a signed URL the client can PUT the file to directly."""
    _require_config()
    url = f"{_storage_base()}/object/upload/sign/{bucket}/{path}"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, headers=_headers(), json={})
    except httpx.HTTPError as exc:
        logger.error("Supabase Storage unreachable: %s", exc)
        raise AppError(503, "File storage is unreachable", code="storage_unavailable") from exc

    if resp.status_code >= 400:
        logger.error("Signed upload URL failed (%s): %s", resp.status_code, resp.text)
        raise AppError(502, "Could not create an upload URL", code="storage_error")

    data = resp.json()
    relative = data.get("url") or ""
    return SignedUpload(
        bucket=bucket,
        path=path,
        upload_url=f"{_storage_base()}{relative}" if relative.startswith("/") else relative,
        token=data.get("token"),
    )


async def create_signed_download_url(
    bucket: str, path: str, expires_in: int | None = None
) -> str:
    """Mint a short-lived read URL for a private object."""
    _require_config()
    ttl = expires_in or settings.signed_url_ttl_seconds
    url = f"{_storage_base()}/object/sign/{bucket}/{path}"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, headers=_headers(), json={"expiresIn": ttl})
    except httpx.HTTPError as exc:
        logger.error("Supabase Storage unreachable: %s", exc)
        raise AppError(503, "File storage is unreachable", code="storage_unavailable") from exc

    if resp.status_code >= 400:
        logger.error("Signed download URL failed (%s): %s", resp.status_code, resp.text)
        raise AppError(502, "Could not create a download URL", code="storage_error")

    relative = resp.json().get("signedURL") or ""
    return f"{_storage_base()}{relative}" if relative.startswith("/") else relative


async def try_signed_download_url(bucket: str, path: str | None) -> str | None:
    """Best-effort signing used when listing many resources.

    A storage outage should degrade a catalog listing to "no link yet" rather than
    failing the whole request.
    """
    if not path:
        return None
    if path.startswith("http://") or path.startswith("https://"):
        return path  # already an absolute URL (e.g. a 'link' resource)
    try:
        return await create_signed_download_url(bucket, path)
    except AppError:
        logger.warning("Could not sign %s/%s", bucket, path)
        return None
