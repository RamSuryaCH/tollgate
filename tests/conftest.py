"""Shared fixtures. Tests run against real Postgres and Redis (db 1), with the mock provider."""

import os
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parent.parent
ADMIN_KEY = "test-admin-key"
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://tollgate:tollgate@127.0.0.1:5432/tollgate_test"
)
TEST_REDIS_URL = os.environ.get("TEST_REDIS_URL", "redis://127.0.0.1:6379/1")

# Must run before tollgate.config.get_settings() is first called.
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["REDIS_URL"] = TEST_REDIS_URL
os.environ["DEFAULT_PROVIDER"] = "mock"
os.environ["ADMIN_API_KEY"] = ADMIN_KEY
os.environ["APP_ENV"] = "test"

# Safety rails: never truncate or flush a non-test database.
if "test" not in (make_url(TEST_DATABASE_URL).database or ""):
    raise RuntimeError("TEST_DATABASE_URL must name a database containing 'test'")
if urlsplit(TEST_REDIS_URL).path.lstrip("/") in ("", "0"):
    raise RuntimeError("TEST_REDIS_URL must use a non-zero Redis db index")

from tollgate.auth import create_api_key  # noqa: E402
from tollgate.main import create_app  # noqa: E402

TRUNCATE_SQL = (
    "TRUNCATE usage_daily, request_logs, messages, conversations, api_keys RESTART IDENTITY CASCADE"
)


@pytest.fixture(scope="session", autouse=True)
def migrated_schema() -> Iterator[None]:
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    command.upgrade(cfg, "head")
    yield


@pytest.fixture
async def app() -> AsyncIterator[FastAPI]:
    application = create_app()
    async with application.router.lifespan_context(application):
        async with application.state.engine.begin() as conn:
            await conn.execute(text(TRUNCATE_SQL))
        await application.state.redis.flushdb()
        yield application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
def admin_headers() -> dict[str, str]:
    return {"X-Admin-Key": ADMIN_KEY}


@pytest.fixture
async def make_key(app: FastAPI):  # type: ignore[no-untyped-def]
    """Create a key directly in the DB. Returns (key_id, plaintext_token)."""

    async def _make(
        *, name: str = "test", rpm: int = 10, cache_enabled: bool = True
    ) -> tuple[str, str]:
        async with app.state.session_factory() as session, session.begin():
            key, token = await create_api_key(
                session, name=name, rpm=rpm, cache_enabled=cache_enabled
            )
            return str(key.id), token

    return _make


@pytest.fixture
async def api_key(make_key) -> str:  # type: ignore[no-untyped-def]
    """Active key with rpm=10 and caching on. Returns the plaintext token."""
    _, token = await make_key()
    return token


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
