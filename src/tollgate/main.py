"""FastAPI application factory and lifespan (engine, Redis, provider setup and teardown)."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from redis.asyncio import Redis

from tollgate import __version__
from tollgate.api import admin, chat, health, usage
from tollgate.config import DEFAULT_ADMIN_API_KEY, get_settings
from tollgate.db import create_db_engine, create_session_factory
from tollgate.providers import ChatProvider, ProviderUnavailable, get_provider

log = logging.getLogger("tollgate")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    if (
        settings.app_env == "production"
        and settings.admin_api_key.get_secret_value() == DEFAULT_ADMIN_API_KEY
    ):
        raise RuntimeError("Set ADMIN_API_KEY to a non-default value in production")

    engine = create_db_engine(settings.database_url)
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    provider: ChatProvider | None
    try:
        provider = get_provider(settings)
    except ProviderUnavailable as exc:
        log.warning("provider unavailable: %s", exc)
        provider = None

    app.state.engine = engine
    app.state.session_factory = create_session_factory(engine)
    app.state.redis = redis
    app.state.provider = provider
    try:
        yield
    finally:
        if provider is not None:
            await provider.aclose()
        await redis.aclose()
        await engine.dispose()


def create_app() -> FastAPI:
    app = FastAPI(title="Tollgate", version=__version__, lifespan=lifespan)
    app.include_router(health.router)
    app.include_router(chat.router)
    app.include_router(admin.router)
    app.include_router(usage.router)
    return app


app = create_app()
