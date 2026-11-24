"""API key generation, hashing, lookup, and admin token checks."""

import hashlib
import hmac
import secrets
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from tollgate.models import ApiKey

KEY_PREFIX = "tg_"
DISPLAY_PREFIX_LENGTH = 10


def generate_api_key() -> str:
    return KEY_PREFIX + secrets.token_urlsafe(32)


def hash_api_key(key: str) -> str:
    """Only this SHA-256 digest is stored. Keys carry 256 bits of entropy, so no salt is needed."""
    return hashlib.sha256(key.encode()).hexdigest()


def bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        return None
    return token


def is_admin_token(candidate: str | None, expected: str) -> bool:
    if not candidate or not expected:
        return False
    return hmac.compare_digest(candidate.encode(), expected.encode())


async def create_api_key(
    session: AsyncSession, *, name: str, rpm: int, cache_enabled: bool
) -> tuple[ApiKey, str]:
    """Insert a key row. Returns the row and the plaintext key, which is shown only once."""
    plaintext = generate_api_key()
    key = ApiKey(
        name=name,
        prefix=plaintext[:DISPLAY_PREFIX_LENGTH],
        key_hash=hash_api_key(plaintext),
        rate_limit_rpm=rpm,
        cache_enabled=cache_enabled,
    )
    session.add(key)
    await session.flush()
    return key, plaintext


async def authenticate_api_key(session: AsyncSession, token: str) -> ApiKey | None:
    """Return the active (not revoked) key for a plaintext token and record last_used_at."""
    stmt = select(ApiKey).where(ApiKey.key_hash == hash_api_key(token), ApiKey.revoked_at.is_(None))
    key = (await session.execute(stmt)).scalar_one_or_none()
    if key is not None:
        key.last_used_at = datetime.now(UTC)
        await session.commit()
    return key
