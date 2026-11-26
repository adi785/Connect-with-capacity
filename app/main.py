"""FastAPI application entrypoint for CAPACITY CONNECT.

Wiring order matters: exception handlers and rate limiting are installed before the
routers so every route inherits the spec's error envelope and default limits.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy import text

from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.core.rate_limit import register_rate_limiting
from app.db.session import dispose_engine, engine
from app.routers import ALL_ROUTERS

logging.basicConfig(
    level=logging.DEBUG if settings.db_echo else logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger("capacity_connect")


def _assert_production_is_safe() -> None:
    """Refuse to serve production traffic with development shortcuts enabled.

    `resolved_auth_mode` already forces "supabase" in production, but unconfigured
    Supabase keys would fail on the first request instead of at boot.
    """
    if not settings.is_production:
        return

    problems: list[str] = []
    if settings.resolved_auth_mode != "supabase":
        problems.append("AUTH_MODE must be 'supabase' in production")
    if not settings.supabase_auth_configured:
        problems.append(
            "Supabase Auth is unconfigured (set SUPABASE_URL, SUPABASE_ANON_KEY/SUPABASE_PUBLISHABLE_KEY, SUPABASE_JWKS_URL or SUPABASE_JWT_SECRET)"
        )
    if not settings.secret_key or settings.secret_key == "dev-insecure-change-me":
        problems.append("SECRET_KEY is unset or still the development default")

    if problems:
        raise RuntimeError(
            "Refusing to start in production: " + "; ".join(problems)
        )


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Validate configuration and prove the database is reachable before serving."""
    _assert_production_is_safe()

    logger.info(
        "Starting CAPACITY CONNECT (env=%s, auth_mode=%s)",
        settings.env,
        settings.resolved_auth_mode,
    )
    if settings.resolved_auth_mode == "dev":
        logger.warning(
            "AUTH_MODE resolved to 'dev': bearer tokens are accepted without "
            "signature verification. Development only."
        )
    if not settings.supabase_service_role_key:
        logger.warning(
            "SUPABASE_SERVICE_ROLE_KEY is unset; signed upload/download URLs "
            "will be unavailable."
        )

    try:
        async with engine.begin() as conn:
            await conn.execute(text("select 1"))
            # Ensure non-destructive schema additions for notifications and trainer_profiles
            await conn.execute(text("""
                ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS employee_id VARCHAR(50);

                ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS summary TEXT;
                ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS category VARCHAR(100);
                ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'published';
                ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
                ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
                ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

                ALTER TABLE public.trainer_profiles ADD COLUMN IF NOT EXISTS organization VARCHAR(200);
                ALTER TABLE public.trainer_profiles ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
                ALTER TABLE public.trainer_profiles ADD COLUMN IF NOT EXISTS experience_years INT;
            """))
        logger.info("Database connection and schema verification OK")
    except Exception as exc:
        # Not fatal: the app still boots so /health can report the fault and the
        # container does not crash-loop while Postgres is coming up.
        logger.error("Database unreachable or migration warning at startup: %s", exc)

    try:
        yield
    finally:
        await dispose_engine()
        logger.info("Shutdown complete")


def create_app() -> FastAPI:
    """Application factory."""
    app = FastAPI(
        title="CAPACITY CONNECT",
        description=(
            "Corporate Training & Learning Management Platform.\n\n"
            "Authentication is a Supabase JWT token in `Authorization: Bearer <token>`. "
            "Signup, login, password reset, and session management are handled "
            "client-side with Supabase Auth; this API verifies tokens and manages "
            "application-side profiles and data."
        ),
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_origin_regex=settings.cors_origin_regex or None,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(GZipMiddleware, minimum_size=1000)

    register_exception_handlers(app)
    register_rate_limiting(app)

    for router in ALL_ROUTERS:
        app.include_router(router, prefix=settings.api_prefix)

    _register_meta_routes(app)
    return app


def _register_meta_routes(app: FastAPI) -> None:
    """Unauthenticated liveness/readiness routes, outside and inside the versioned prefix."""

    @app.get("/", include_in_schema=False)
    async def root() -> dict:
        return {
            "name": "CAPACITY CONNECT API",
            "version": "1.0.0",
            "api_prefix": settings.api_prefix,
            "docs": "/docs",
        }

    @app.get("/health", tags=["meta"], summary="Liveness probe")
    @app.get("/api/v1/health", tags=["meta"], summary="Liveness probe (API prefix)")
    async def health() -> dict:
        return {"status": "ok", "env": settings.env}

    @app.get("/health/ready", tags=["meta"], summary="Readiness probe (checks Postgres)")
    @app.get("/api/v1/health/ready", tags=["meta"], summary="Readiness probe (API prefix)")
    async def ready() -> dict:
        """Returns 503 when the database is unreachable, so orchestrators hold traffic."""
        from fastapi import HTTPException, status as http_status

        try:
            async with engine.connect() as conn:
                await conn.execute(text("select 1"))
        except Exception as exc:
            logger.error("Readiness check failed: %s", exc)
            raise HTTPException(
                status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Database unavailable",
            )
        return {"status": "ready", "database": "ok"}


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=not settings.is_production,
    )
