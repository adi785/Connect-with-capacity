import asyncio
import os
import pathlib
import pytest
import pytest_asyncio
from collections.abc import AsyncIterator
from httpx import AsyncClient, ASGITransport
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

# --------------------------------------------------------------------------
# 1. Teach SQLite how to compile PostgreSQL dialect types (e.g. JSONB)
# --------------------------------------------------------------------------
@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(type_, compiler, **kw):
    return "JSON"

# --------------------------------------------------------------------------
# 2. Environment & Database Configuration for Testing
# --------------------------------------------------------------------------
TEST_DB_FILE = pathlib.Path("./test_capacity_connect_isolated.db").resolve()
DEFAULT_SQLITE_URL = f"sqlite+aiosqlite:///{TEST_DB_FILE.as_posix()}"

RESOLVED_TEST_DB_URL = os.environ.get("TEST_DATABASE_URL") or DEFAULT_SQLITE_URL

# Force test configuration in environment before importing the application
os.environ["ENV"] = "test"
os.environ["AUTH_MODE"] = "dev"
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["DATABASE_URL"] = RESOLVED_TEST_DB_URL

# --------------------------------------------------------------------------
# 3. Hard Safety Guard against Live / Production Databases
# --------------------------------------------------------------------------
def assert_test_database_safety(db_url: str) -> None:
    """Refuse to run tests if the database URL points to a live Supabase or production instance."""
    dangerous_signatures = [
        "supabase.co",
        "pooler.supabase.com",
        "khbunbecvjhnxfhvtpws",
    ]
    for signature in dangerous_signatures:
        if signature in db_url.lower():
            raise RuntimeError(
                f"\n\n🚨 DANGER: Test suite attempted to run against live Supabase database:\n"
                f"   '{db_url}'\n"
                f"Automated tests are STRICTLY FORBIDDEN from writing to production or live Supabase databases.\n"
                f"Configure a dedicated TEST_DATABASE_URL or use the default isolated SQLite test database.\n"
            )

assert_test_database_safety(RESOLVED_TEST_DB_URL)

# Now safely import the FastAPI app and SQLAlchemy models
from app.db.base import Base
from app.db.session import get_db
from app.main import app

# --------------------------------------------------------------------------
# 4. Dedicated Test Async Engine & Session Factory
# --------------------------------------------------------------------------
test_engine: AsyncEngine = create_async_engine(
    RESOLVED_TEST_DB_URL,
    echo=False,
    future=True,
)

test_session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
    bind=test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)

async def override_get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI get_db dependency override yielding test database sessions."""
    async with test_session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        else:
            await session.commit()

# --------------------------------------------------------------------------
# 5. Pytest Hooks and Lifecycle Fixtures
# --------------------------------------------------------------------------
def pytest_sessionstart(session):
    """Run before tests start."""
    assert_test_database_safety(RESOLVED_TEST_DB_URL)

def pytest_sessionfinish(session, exitstatus):
    """Run after all tests finish to clean up test database file."""
    if TEST_DB_FILE.exists():
        try:
            TEST_DB_FILE.unlink()
        except Exception:
            pass

@pytest_asyncio.fixture(autouse=True)
async def setup_clean_database_per_test():
    """Create all tables fresh before each test and drop them afterwards for total isolation."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    """Provide AsyncClient wired with the isolated test database dependency override."""
    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_db, None)
