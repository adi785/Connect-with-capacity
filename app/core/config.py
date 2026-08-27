"""Application configuration using pydantic-settings.

Only DATABASE_URL is strictly required. Everything else has a sane default so the
app can boot in development with a minimal .env file.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ---------- App ----------
    env: str = Field(default="development", alias="ENV")
    secret_key: str = Field(default="dev-insecure-change-me", alias="SECRET_KEY")
    cors_origins: str = Field(default="http://localhost:3000", alias="CORS_ORIGINS")
    api_prefix: str = "/api/v1"

    # ---------- Database (direct Postgres connection for SQLAlchemy) ----------
    database_url: str = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/postgres",
        alias="DATABASE_URL",
    )
    db_echo: bool = Field(default=False, alias="DB_ECHO")
    db_pool_size: int = Field(default=10, alias="DB_POOL_SIZE")
    db_max_overflow: int = Field(default=5, alias="DB_MAX_OVERFLOW")

    # ---------- Supabase (Auth, Storage & Database) ----------
    supabase_url: str = Field(default="", alias="SUPABASE_URL")
    supabase_anon_key: str = Field(default="", alias="SUPABASE_ANON_KEY")
    supabase_publishable_key: str = Field(default="", alias="SUPABASE_PUBLISHABLE_KEY")
    supabase_service_role_key: str = Field(default="", alias="SUPABASE_SERVICE_ROLE_KEY")
    supabase_secret_key: str = Field(default="", alias="SUPABASE_SECRET_KEY")
    supabase_jwks_url: str = Field(default="", alias="SUPABASE_JWKS_URL")
    supabase_jwt_secret: str = Field(default="", alias="SUPABASE_JWT_SECRET")

    bucket_lecture_resources: str = Field(
        default="lecture-resources", alias="BUCKET_LECTURE_RESOURCES"
    )
    bucket_certificates: str = Field(default="certificates", alias="BUCKET_CERTIFICATES")
    bucket_profile_photos: str = Field(
        default="profile-photos", alias="BUCKET_PROFILE_PHOTOS"
    )
    signed_url_ttl_seconds: int = Field(default=3600, alias="SIGNED_URL_TTL_SECONDS")

    # ---------- Supabase Auth ----------
    # auth_mode: "supabase" verifies real JWTs issued by Supabase Auth via JWKS / JWT secret / Auth API.
    #            "dev" accepts unsigned/self-describing tokens so the backend is runnable in offline tests.
    auth_mode: str = Field(default="auto", alias="AUTH_MODE")

    # Emails listed here are auto-promoted to an approved admin on first sign-in.
    # Solves the cold-start problem: without it nobody can approve the first user.
    bootstrap_admin_emails: str = Field(default="", alias="BOOTSTRAP_ADMIN_EMAILS")

    # ---------- Redis / rate limiting ----------
    redis_url: str = Field(default="", alias="REDIS_URL")
    rate_limit_enabled: bool = Field(default=True, alias="RATE_LIMIT_ENABLED")
    rate_limit_default: str = Field(default="120/minute", alias="RATE_LIMIT_DEFAULT")
    rate_limit_sensitive: str = Field(default="10/minute", alias="RATE_LIMIT_SENSITIVE")

    # ---------- Uploads ----------
    max_upload_mb_video: int = Field(default=500, alias="MAX_UPLOAD_MB_VIDEO")
    max_upload_mb_document: int = Field(default=50, alias="MAX_UPLOAD_MB_DOCUMENT")
    max_upload_mb_image: int = Field(default=5, alias="MAX_UPLOAD_MB_IMAGE")

    # ---------- Email ----------
    smtp_host: str = Field(default="", alias="SMTP_HOST")
    smtp_port: int = Field(default=587, alias="SMTP_PORT")
    smtp_user: str = Field(default="", alias="SMTP_USER")
    smtp_password: str = Field(default="", alias="SMTP_PASSWORD")

    @field_validator("database_url")
    @classmethod
    def _require_async_driver(cls, v: str) -> str:
        """SQLAlchemy needs the asyncpg driver; accept a plain URL and upgrade it."""
        if v.startswith("postgresql://"):
            return v.replace("postgresql://", "postgresql+asyncpg://", 1)
        if v.startswith("postgres://"):
            return v.replace("postgres://", "postgresql+asyncpg://", 1)
        return v

    # ---------- Derived helpers ----------
    @property
    def is_production(self) -> bool:
        return self.env.lower() in {"production", "prod"}

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def effective_service_role_key(self) -> str:
        return self.supabase_service_role_key or self.supabase_secret_key

    @property
    def effective_anon_key(self) -> str:
        return self.supabase_anon_key or self.supabase_publishable_key

    @property
    def effective_jwks_url(self) -> str:
        if self.supabase_jwks_url:
            return self.supabase_jwks_url
        if self.supabase_url:
            return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        return ""

    @property
    def admin_emails(self) -> set[str]:
        return {
            e.strip().lower()
            for e in self.bootstrap_admin_emails.split(",")
            if e.strip()
        }

    @property
    def supabase_auth_configured(self) -> bool:
        return bool(
            self.supabase_jwks_url
            or self.supabase_jwt_secret
            or (self.supabase_url and self.effective_anon_key)
        )

    @property
    def resolved_auth_mode(self) -> str:
        """Resolve "auto" into a concrete mode.

        Production always demands real Supabase verification.
        """
        mode = self.auth_mode.lower()
        if mode in {"supabase", "dev"}:
            return mode
        if self.is_production:
            return "supabase"
        return "supabase" if self.supabase_auth_configured else "dev"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
