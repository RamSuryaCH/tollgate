"""GET /healthz: checks Postgres and Redis. Never raises."""

import asyncio

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tollgate.db import get_session_factory

router = APIRouter(tags=["health"])
CHECK_TIMEOUT_SECONDS = 2.0


async def _check_postgres(factory: async_sessionmaker[AsyncSession]) -> bool:
    try:
        async with asyncio.timeout(CHECK_TIMEOUT_SECONDS), factory() as session:
            await session.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


async def _check_redis(request: Request) -> bool:
    try:
        await asyncio.wait_for(request.app.state.redis.ping(), CHECK_TIMEOUT_SECONDS)
        return True
    except Exception:
        return False


@router.get("/healthz")
async def healthz(request: Request) -> JSONResponse:
    postgres_ok = await _check_postgres(get_session_factory(request))
    redis_ok = await _check_redis(request)
    healthy = postgres_ok and redis_ok
    body = {
        "status": "ok" if healthy else "degraded",
        "postgres": "ok" if postgres_ok else "error",
        "redis": "ok" if redis_ok else "error",
    }
    return JSONResponse(body, status_code=200 if healthy else 503)
