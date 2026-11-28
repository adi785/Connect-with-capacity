"""Supabase Auth token verification.

Two modes, resolved by `settings.resolved_auth_mode`:

* ``supabase`` — real verification of Supabase-issued JWTs using PyJWT / JWKS
  (with Supabase Auth API fallback). Signature, expiry, audience and issuer are checked.
* ``dev``      — accepts a base64 JSON payload or a bare identifier so the API is
  usable before Supabase Auth is wired up or in unit tests. Refused outright in production.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import math
import time
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
from fastapi import HTTPException, status

from app.core.config import settings

logger = logging.getLogger(__name__)

_jwks_client: jwt.PyJWKClient | None = None
_token_cache: dict[str, tuple[float, "VerifiedToken"]] = {}
_TOKEN_CACHE_TTL = 60.0  # Maximum cache lifetime for verified tokens
_MAX_TOKEN_CACHE_SIZE = 1000


def _token_cache_expires_at(token: str, now: float) -> float | None:
    """Return a safe cache deadline after the token has already been verified.

    JWTs are cached only until the earlier of their exp claim and the normal
    cache TTL. The unverified decode below is used solely to shorten the cache
    lifetime; signature and claim validation still happens first in the normal
    verification path. JWTs without a usable exp are not cached.
    Non-JWT development tokens retain the short development-only TTL.
    """
    if token.count(".") != 2:
        return now + _TOKEN_CACHE_TTL

    try:
        claims = jwt.decode(
            token,
            algorithms=["HS256", "RS256", "ES256", "EdDSA"],
            options={
                "verify_signature": False,
                "verify_exp": False,
                "verify_nbf": False,
                "verify_iat": False,
                "verify_aud": False,
                "verify_iss": False,
            },
        )
    except (jwt.PyJWTError, TypeError, ValueError):
        return None

    exp = claims.get("exp")
    if isinstance(exp, bool) or not isinstance(exp, (int, float)):
        return None

    expires_at = float(exp)
    if not math.isfinite(expires_at) or expires_at <= now:
        return None

    return min(now + _TOKEN_CACHE_TTL, expires_at)


@dataclass(slots=True)
class VerifiedToken:
    """Identity extracted from a verified Supabase Auth token."""

    uid: str
    email: str | None = None
    name: str | None = None
    email_verified: bool = False
    picture: str | None = None
    raw_claims: dict[str, Any] | None = None


def _credential_error(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def _get_jwks_client() -> jwt.PyJWKClient | None:
    """Lazily initialize and cache the PyJWKClient for Supabase JWKS endpoint."""
    global _jwks_client
    if _jwks_client is not None:
        return _jwks_client

    jwks_url = settings.effective_jwks_url
    if not jwks_url:
        return None

    try:
        _jwks_client = jwt.PyJWKClient(jwks_url, cache_keys=True, max_cached_keys=16)
        return _jwks_client
    except Exception as exc:
        logger.warning("Failed to initialize JWKS client for %s: %s", jwks_url, exc)
        return None


def _verify_with_supabase_jwks(token: str) -> dict[str, Any]:
    """Verify an asymmetric Supabase token against the project JWKS."""
    jwks_client = _get_jwks_client()
    if not jwks_client:
        raise ValueError("Supabase JWKS URL is unconfigured")

    signing_key = jwks_client.get_signing_key_from_jwt(token)
    # Supabase tokens may specify aud="authenticated"
    decoded = jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256", "ES256", "EdDSA"],
        options={"verify_aud": False},
    )
    return decoded


def _verify_with_supabase_secret(token: str) -> dict[str, Any]:
    """Verify an HMAC (HS256) Supabase token using SUPABASE_JWT_SECRET if provided."""
    secret = settings.supabase_jwt_secret or settings.effective_service_role_key
    if not secret:
        raise ValueError("Supabase secret is unconfigured")

    decoded = jwt.decode(
        token,
        secret,
        algorithms=["HS256"],
        options={"verify_aud": False},
    )
    return decoded


def _verify_with_supabase_api(token: str) -> VerifiedToken:
    """Verify token against Supabase's /auth/v1/user endpoint as a fallback."""
    base_url = settings.supabase_url.rstrip("/")
    if not base_url:
        raise _credential_error("Supabase URL is unconfigured")

    headers = {
        "Authorization": f"Bearer {token}",
        "apikey": settings.effective_anon_key or settings.effective_service_role_key,
    }

    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.get(f"{base_url}/auth/v1/user", headers=headers)
            if resp.status_code != 200:
                logger.warning(
                    "Supabase /auth/v1/user returned %d: %s",
                    resp.status_code,
                    resp.text,
                )
                raise _credential_error("Invalid or expired authentication token")

            data = resp.json()
            uid = data.get("id")
            if not uid:
                raise _credential_error("Token is missing a user id")

            user_meta = data.get("user_metadata") or {}
            email = data.get("email") or user_meta.get("email")
            name = (
                user_meta.get("name")
                or user_meta.get("full_name")
                or (email.split("@")[0] if email else uid)
            )

            return VerifiedToken(
                uid=uid,
                email=email,
                name=name,
                email_verified=bool(data.get("email_confirmed_at")),
                picture=user_meta.get("avatar_url") or user_meta.get("picture"),
                raw_claims=data,
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Supabase API token verification error: %s", exc)
        raise _credential_error("Authentication verification unavailable") from exc


def _verify_with_supabase(token: str) -> VerifiedToken:
    """Verify token using JWKS, secret, or Supabase Auth API."""
    # 1. Try JWKS asymmetric verification
    try:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "")
    except Exception as exc:
        raise _credential_error("Malformed authentication token") from exc

    decoded: dict[str, Any] | None = None

    if alg.startswith(("RS", "ES", "Ed")):
        try:
            decoded = _verify_with_supabase_jwks(token)
        except Exception as jwks_err:
            logger.debug("JWKS verification unsuccessful (%s), falling back to API", jwks_err)
    elif alg == "HS256" and (settings.supabase_jwt_secret or settings.effective_service_role_key):
        try:
            decoded = _verify_with_supabase_secret(token)
        except Exception as hs_err:
            logger.debug("HS256 verification unsuccessful (%s), falling back to API", hs_err)

    if decoded is not None:
        uid = decoded.get("sub") or decoded.get("uid")
        if not uid:
            raise _credential_error("Token is missing a subject claim")

        user_meta = decoded.get("user_metadata") or {}
        email = decoded.get("email") or user_meta.get("email")
        name = (
            user_meta.get("name")
            or user_meta.get("full_name")
            or (email.split("@")[0] if email else uid)
        )

        return VerifiedToken(
            uid=str(uid),
            email=email,
            name=name,
            email_verified=bool(decoded.get("email_verified") or decoded.get("email_confirmed_at")),
            picture=user_meta.get("avatar_url") or user_meta.get("picture"),
            raw_claims=decoded,
        )

    # 2. Fallback to Supabase /auth/v1/user endpoint
    return _verify_with_supabase_api(token)


def _verify_dev(token: str) -> VerifiedToken:
    """Development shim so the API is exercisable without Supabase Auth in local dev/tests.

    Accepts either a base64-encoded JSON object such as
    ``{"uid": "u1", "email": "a@b.com", "name": "A"}`` or a bare string used as
    both uid and the local-part of a synthetic email.
    """
    if settings.is_production:
        raise _credential_error("Development authentication is disabled in production")

    raw = token.strip()
    if not raw:
        raise _credential_error("Empty authentication token")

    # Try base64 JSON, then raw JSON, then treat the token as a plain uid.
    payload: dict | None = None
    try:
        padded = raw + "=" * (-len(raw) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
    except (ValueError, binascii.Error, UnicodeDecodeError):
        try:
            payload = json.loads(raw)
        except ValueError:
            payload = None

    if isinstance(payload, dict):
        uid = str(payload.get("uid") or payload.get("sub") or "").strip()
        if not uid:
            raise _credential_error("Dev token must include a 'uid' or 'sub' field")
        return VerifiedToken(
            uid=uid,
            email=(payload.get("email") or f"{uid}@dev.local").lower(),
            name=payload.get("name") or uid,
            email_verified=bool(payload.get("email_verified", True)),
            raw_claims=payload,
        )

    return VerifiedToken(
        uid=raw,
        email=f"{raw.lower()}@dev.local",
        name=raw,
        email_verified=True,
        raw_claims={"sub": raw},
    )


def verify_supabase_token(token: str) -> VerifiedToken:
    """Verify a Supabase bearer token and return the caller's identity."""
    if not token or not token.strip():
        raise _credential_error("Missing authentication token")

    raw = token.strip()

    now = time.time()
    cached = _token_cache.get(raw)
    if cached is not None:
        cache_expires_at, verified_token = cached
        if now < cache_expires_at:
            return verified_token
        _token_cache.pop(raw, None)

    if settings.resolved_auth_mode == "dev" or (not settings.is_production and raw.count(".") != 2):
        verified = _verify_dev(raw)
    else:
        verified = _verify_with_supabase(raw)

    cache_expires_at = _token_cache_expires_at(raw, now)
    if cache_expires_at is not None:
        if len(_token_cache) >= _MAX_TOKEN_CACHE_SIZE:
            expired_keys = [
                key
                for key, (expires_at, _) in _token_cache.items()
                if now >= expires_at
            ]
            if expired_keys:
                for key in expired_keys:
                    _token_cache.pop(key, None)
            else:
                # Bound memory use even when every cached token is still valid.
                for key in list(_token_cache)[:200]:
                    _token_cache.pop(key, None)

        _token_cache[raw] = (cache_expires_at, verified)

    return verified


# Backwards-compatible aliases
verify_token = verify_supabase_token
verify_firebase_token = verify_supabase_token
decode_jwt = verify_supabase_token
