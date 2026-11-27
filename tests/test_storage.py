"""Regression tests for Supabase Storage API-key authentication."""

import pytest

from app.core.config import settings
from app.core.errors import AppError
from app.core.storage import _headers, _require_config


def _set_storage_keys(monkeypatch, *, url: str, service_role: str = "", secret: str = "") -> None:
    monkeypatch.setattr(settings, "supabase_url", url)
    monkeypatch.setattr(settings, "supabase_service_role_key", service_role)
    monkeypatch.setattr(settings, "supabase_secret_key", secret)


def test_new_secret_key_is_accepted_and_sent_only_as_apikey(monkeypatch) -> None:
    _set_storage_keys(
        monkeypatch,
        url="https://example.supabase.co",
        secret="sb_secret_test",
    )

    _require_config()

    assert _headers() == {"apikey": "sb_secret_test"}


def test_legacy_service_role_key_keeps_bearer_compatibility(monkeypatch) -> None:
    _set_storage_keys(
        monkeypatch,
        url="https://example.supabase.co",
        service_role="legacy-service-role-jwt",
    )

    _require_config()

    assert _headers() == {
        "apikey": "legacy-service-role-jwt",
        "Authorization": "Bearer legacy-service-role-jwt",
    }


def test_legacy_service_role_key_takes_precedence_when_both_are_configured(monkeypatch) -> None:
    _set_storage_keys(
        monkeypatch,
        url="https://example.supabase.co",
        service_role="legacy-service-role-jwt",
        secret="sb_secret_test",
    )

    assert _headers() == {
        "apikey": "legacy-service-role-jwt",
        "Authorization": "Bearer legacy-service-role-jwt",
    }


@pytest.mark.parametrize(
    ("url", "service_role", "secret"),
    [
        ("", "", "sb_secret_test"),
        ("https://example.supabase.co", "", ""),
    ],
)
def test_storage_requires_project_url_and_a_server_key(
    monkeypatch, url: str, service_role: str, secret: str
) -> None:
    _set_storage_keys(
        monkeypatch,
        url=url,
        service_role=service_role,
        secret=secret,
    )

    with pytest.raises(AppError) as exc_info:
        _require_config()

    assert exc_info.value.status_code == 503
    assert exc_info.value.code == "storage_unconfigured"
