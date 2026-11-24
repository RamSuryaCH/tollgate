"""API key administration: create, list, and revoke."""

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from tollgate.api.deps import PrincipalDep, SessionDep, SettingsDep, require_admin
from tollgate.auth import create_api_key
from tollgate.models import ApiKey
from tollgate.schemas import KeyCreated, KeyCreateRequest, KeyOut

router = APIRouter(prefix="/v1", tags=["keys"])


def _key_out(key: ApiKey) -> KeyOut:
    return KeyOut(
        id=key.id,
        name=key.name,
        prefix=key.prefix,
        rate_limit_rpm=key.rate_limit_rpm,
        cache_enabled=key.cache_enabled,
        created_at=key.created_at,
        last_used_at=key.last_used_at,
        revoked_at=key.revoked_at,
    )


@router.post(
    "/admin/keys",
    status_code=201,
    response_model=KeyCreated,
    dependencies=[Depends(require_admin)],
)
async def create_key(
    body: KeyCreateRequest, session: SessionDep, settings: SettingsDep
) -> KeyCreated:
    rpm = body.rate_limit_rpm or settings.default_rate_limit_rpm
    key, plaintext = await create_api_key(
        session, name=body.name, rpm=rpm, cache_enabled=body.cache_enabled
    )
    await session.commit()
    return KeyCreated(
        id=key.id,
        name=key.name,
        prefix=key.prefix,
        key=plaintext,
        rate_limit_rpm=key.rate_limit_rpm,
        cache_enabled=key.cache_enabled,
        created_at=key.created_at,
    )


@router.get("/keys", response_model=list[KeyOut])
async def list_keys(principal: PrincipalDep, session: SessionDep) -> list[KeyOut]:
    """Admin sees all keys. An API key sees only itself. Secrets are never returned."""
    stmt = select(ApiKey).order_by(ApiKey.created_at.desc())
    if not principal.is_admin and principal.api_key is not None:
        stmt = stmt.where(ApiKey.id == principal.api_key.id)
    result = await session.execute(stmt)
    return [_key_out(key) for key in result.scalars().all()]


@router.post("/keys/{key_id}/revoke", response_model=KeyOut, dependencies=[Depends(require_admin)])
async def revoke_key(key_id: UUID, session: SessionDep) -> KeyOut:
    key = await session.get(ApiKey, key_id)
    if key is None:
        raise HTTPException(status_code=404, detail="Key not found")
    if key.revoked_at is None:
        key.revoked_at = datetime.now(UTC)
    await session.commit()
    return _key_out(key)
