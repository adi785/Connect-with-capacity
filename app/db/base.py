"""Declarative base and shared column helpers."""

from __future__ import annotations

import uuid

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base class for all ORM models."""


def new_uuid() -> uuid.UUID:
    """Generate a primary key.

    Postgres also defaults these columns to gen_random_uuid(); generating the id
    client-side means we know the id without a round-trip after INSERT.
    """
    return uuid.uuid4()
