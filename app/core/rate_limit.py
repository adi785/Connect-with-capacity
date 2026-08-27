"""Rate limiting via slowapi, Redis-backed when REDIS_URL is set.

slowapi is optional: if it is not installed the decorators degrade to no-ops so
the app still boots. Limits are keyed by authenticated user when available and
fall back to the client IP otherwise.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request

from app.core.config import settings
from app.core.errors import error_payload

logger = logging.getLogger(__name__)

try:
    from slowapi import Limiter
    from slowapi.errors import RateLimitExceeded
    from slowapi.middleware import SlowAPIMiddleware
    from slowapi.util import get_remote_address

    _SLOWAPI_AVAILABLE = True
except ImportError:  # pragma: no cover - optional dependency
    _SLOWAPI_AVAILABLE = False
    RateLimitExceeded = None  # type: ignore[assignment]


def _rate_key(request: Request) -> str:
    """Prefer a stable per-user key so one noisy NAT cannot starve other users."""
    uid = getattr(request.state, "firebase_uid", None)
    if uid:
        return f"user:{uid}"
    if _SLOWAPI_AVAILABLE:
        return get_remote_address(request)
    return request.client.host if request.client else "anonymous"


def _build_limiter():
    if not _SLOWAPI_AVAILABLE:
        return None

    kwargs: dict = {
        "key_func": _rate_key,
        "default_limits": [settings.rate_limit_default],
        "enabled": settings.rate_limit_enabled,
    }
    if settings.redis_url:
        kwargs["storage_uri"] = settings.redis_url
    else:
        # In-memory counters are per-process; fine for dev, not for multi-replica prod.
        if settings.is_production and settings.rate_limit_enabled:
            logger.warning(
                "Rate limiting is enabled in production without REDIS_URL; "
                "counters will not be shared across instances."
            )
    return Limiter(**kwargs)


limiter = _build_limiter()

# Decorator applied to sensitive routes. A no-op when slowapi is unavailable.
if limiter is not None:
    sensitive_rate_limit = limiter.limit(settings.rate_limit_sensitive)
else:  # pragma: no cover - optional dependency

    def sensitive_rate_limit(func):
        return func


def register_rate_limiting(app: FastAPI) -> None:
    """Attach limiter state, middleware, and the 429 handler."""
    if limiter is None:
        logger.info("slowapi not installed; rate limiting disabled")
        return

    app.state.limiter = limiter
    app.add_middleware(SlowAPIMiddleware)

    @app.exception_handler(RateLimitExceeded)
    async def _rate_limited(_: Request, exc: RateLimitExceeded):
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=429,
            content=error_payload(429, f"Rate limit exceeded: {exc.detail}"),
        )
