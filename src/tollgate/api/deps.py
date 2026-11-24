"""FastAPI dependencies: settings, DB session, Redis, provider, and API/admin authentication."""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from tollgate.auth import authenticate_api_key, bearer_token, is_admin_token
from tollgate.config import Settings, get_settings
from tollgate.db import get_session
from tollgate.models import ApiKey
from tollgate.providers import ChatProvider


def settings_dep() -> Settings:
    return get_settings()


def get_redis(request: Request) -> Redis:
    redis: Redis = request.app.state.redis
    return redis


def get_provider_dep(request: Request) -> ChatProvider:
    provider: ChatProvider | None = request.app.state.provider
    if provider is None:
        raise HTTPException(status_code=503, detail="Model provider is not configured")
    return provider


@dataclass(frozen=True)
class Principal:
    is_admin: bool
    api_key: ApiKey | None


AuthorizationHeader = Annotated[str | None, Header()]
AdminKeyHeader = Annotated[str | None, Header(alias="X-Admin-Key")]
SettingsDep = Annotated[Settings, Depends(settings_dep)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]
RedisDep = Annotated[Redis, Depends(get_redis)]
ProviderDep = Annotated[ChatProvider, Depends(get_provider_dep)]


def _admin_requested(
    authorization: str | None, x_admin_key: str | None, settings: Settings
) -> bool:
    expected = settings.admin_api_key.get_secret_value()
    return is_admin_token(x_admin_key, expected) or is_admin_token(
        bearer_token(authorization), expected
    )


async def get_api_key(
    session: SessionDep,
    authorization: AuthorizationHeader = None,
) -> ApiKey:
    """Require an active API key as a Bearer token. Admin tokens are rejected here."""
    token = bearer_token(authorization)
    if token is None:
        raise HTTPException(
            status_code=401, detail="Missing API key", headers={"WWW-Authenticate": "Bearer"}
        )
    key = await authenticate_api_key(session, token)
    if key is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid or revoked API key",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return key


ApiKeyDep = Annotated[ApiKey, Depends(get_api_key)]


async def require_admin(
    settings: SettingsDep,
    authorization: AuthorizationHeader = None,
    x_admin_key: AdminKeyHeader = None,
) -> None:
    if not _admin_requested(authorization, x_admin_key, settings):
        raise HTTPException(status_code=401, detail="Admin key required")


async def get_principal(
    session: SessionDep,
    settings: SettingsDep,
    authorization: AuthorizationHeader = None,
    x_admin_key: AdminKeyHeader = None,
) -> Principal:
    """Admin key sees everything. An API key sees only its own data."""
    if _admin_requested(authorization, x_admin_key, settings):
        return Principal(is_admin=True, api_key=None)
    token = bearer_token(authorization)
    if token is None:
        raise HTTPException(status_code=401, detail="Missing API key")
    key = await authenticate_api_key(session, token)
    if key is None:
        raise HTTPException(status_code=401, detail="Invalid or revoked API key")
    return Principal(is_admin=False, api_key=key)


PrincipalDep = Annotated[Principal, Depends(get_principal)]
