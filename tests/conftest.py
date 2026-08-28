import pytest
import pytest_asyncio
from collections.abc import AsyncIterator
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.db.session import engine

@pytest_asyncio.fixture(autouse=True)
async def cleanup_db_connections():
    yield
    await engine.dispose()

@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
