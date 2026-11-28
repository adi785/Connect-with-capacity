"""Regression tests for JWT verification cache expiration."""

from types import SimpleNamespace

import jwt
import pytest
from fastapi import HTTPException

from app.core import security
from app.core.config import settings
from app.core.security import VerifiedToken, verify_supabase_token


_TEST_SIGNING_KEY = "unit-test-signing-key-with-at-least-32-bytes"


@pytest.fixture(autouse=True)
def clear_token_cache():
    security._token_cache.clear()
    yield
    security._token_cache.clear()


@pytest.fixture
def supabase_mode(monkeypatch):
    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "auth_mode", "supabase")


def _make_jwt(*, exp=None) -> str:
    claims = {"sub": "test-user"}
    if exp is not None:
        claims["exp"] = exp
    return jwt.encode(claims, _TEST_SIGNING_KEY, algorithm="HS256")


def test_verified_jwt_cache_never_outlives_exp_claim(monkeypatch, supabase_mode):
    now = [1_700_000_000.0]
    expires_at = now[0] + 10
    token = _make_jwt(exp=expires_at)
    verification_calls = []

    monkeypatch.setattr(
        security,
        "time",
        SimpleNamespace(time=lambda: now[0]),
    )

    def verify(_token):
        verification_calls.append(_token)
        if now[0] >= expires_at:
            raise HTTPException(status_code=401, detail="Token expired")
        # Simulate the Auth API fallback, whose response does not include JWT claims.
        return VerifiedToken(uid="test-user", raw_claims={})

    monkeypatch.setattr(security, "_verify_with_supabase", verify)

    assert verify_supabase_token(token).uid == "test-user"

    now[0] = expires_at - 0.1
    assert verify_supabase_token(token).uid == "test-user"
    assert len(verification_calls) == 1

    now[0] = expires_at
    with pytest.raises(HTTPException) as exc_info:
        verify_supabase_token(token)

    assert exc_info.value.status_code == 401
    assert len(verification_calls) == 2


def test_jwt_cache_lifetime_is_capped_at_normal_ttl(monkeypatch, supabase_mode):
    now = [1_700_000_000.0]
    token = _make_jwt(exp=now[0] + 120)
    verification_calls = []

    monkeypatch.setattr(
        security,
        "time",
        SimpleNamespace(time=lambda: now[0]),
    )

    def verify(_token):
        verification_calls.append(_token)
        return VerifiedToken(uid="test-user", raw_claims={})

    monkeypatch.setattr(security, "_verify_with_supabase", verify)

    verify_supabase_token(token)
    now[0] += security._TOKEN_CACHE_TTL + 1
    verify_supabase_token(token)

    assert len(verification_calls) == 2


def test_jwt_without_numeric_exp_is_not_cached(monkeypatch, supabase_mode):
    now = [1_700_000_000.0]
    token = _make_jwt()
    verification_calls = []

    monkeypatch.setattr(
        security,
        "time",
        SimpleNamespace(time=lambda: now[0]),
    )
    monkeypatch.setattr(
        security,
        "_verify_with_supabase",
        lambda _token: (
            verification_calls.append(_token)
            or VerifiedToken(uid="test-user", raw_claims={})
        ),
    )

    verify_supabase_token(token)
    verify_supabase_token(token)

    assert len(verification_calls) == 2
