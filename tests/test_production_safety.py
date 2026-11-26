"""Regression tests for production startup configuration validation."""

import pytest

from app.core.config import Settings, settings
from app.main import _assert_production_is_safe


def _configure_valid_supabase_production(monkeypatch) -> None:
    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "auth_mode", "supabase")
    monkeypatch.setattr(
        settings,
        "supabase_jwks_url",
        "https://example.supabase.co/auth/v1/.well-known/jwks.json",
    )
    monkeypatch.setattr(settings, "supabase_url", "")
    monkeypatch.setattr(settings, "supabase_anon_key", "")
    monkeypatch.setattr(settings, "supabase_publishable_key", "")
    monkeypatch.setattr(settings, "supabase_jwt_secret", "")


def test_secret_key_is_loaded_from_environment(monkeypatch) -> None:
    monkeypatch.setenv("SECRET_KEY", "configured-test-secret")
    configured = Settings(_env_file=None)
    assert configured.secret_key == "configured-test-secret"


@pytest.mark.parametrize("secret_key", ["", "dev-insecure-change-me"])
def test_production_rejects_missing_or_default_secret_key(monkeypatch, secret_key) -> None:
    _configure_valid_supabase_production(monkeypatch)
    monkeypatch.setattr(settings, "secret_key", secret_key)

    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        _assert_production_is_safe()


def test_production_starts_with_valid_auth_and_secret_configuration(monkeypatch) -> None:
    _configure_valid_supabase_production(monkeypatch)
    monkeypatch.setattr(settings, "secret_key", "a-configured-production-secret")

    _assert_production_is_safe()


def test_non_production_environment_does_not_require_production_secret(monkeypatch) -> None:
    monkeypatch.setattr(settings, "env", "test")
    monkeypatch.setattr(settings, "secret_key", "dev-insecure-change-me")

    _assert_production_is_safe()
