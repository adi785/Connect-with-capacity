"""Async SQLAlchemy engine and session management."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings


def _engine_kwargs() -> dict:
    kwargs: dict = {"echo": settings.db_echo, "pool_pre_ping": True, "pool_recycle": 1800}
    # NullPool-style URLs (e.g. pgbouncer) ignore sizing; only pass it for direct conns.
    if "sqlite" not in settings.database_url:
        kwargs["pool_size"] = settings.db_pool_size
        kwargs["max_overflow"] = settings.db_max_overflow
    return kwargs


engine: AsyncEngine = create_async_engine(settings.database_url, **_engine_kwargs())

async_session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,  # keep attributes readable after commit for serialization
    autoflush=False,
)


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a session, committing on success.

    Routes and services do not need to call commit(); they may flush() when they
    need a generated id. Any exception rolls the whole request back.
    """
    async with async_session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        else:
            await session.commit()


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Standalone session context for scripts and background tasks."""
    async with async_session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        else:
            await session.commit()


async def dispose_engine() -> None:
    await engine.dispose()
