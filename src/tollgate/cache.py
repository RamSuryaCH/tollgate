"""Exact-match Redis cache for deterministic (temperature=0, non-stream) completions."""

import hashlib
import json
from collections.abc import Sequence
from typing import Any

from redis.asyncio import Redis

from tollgate.providers.base import ProviderMessage, canonical_json

CACHE_PREFIX = "tollgate:cache:"


def build_cache_key(
    *,
    model: str,
    messages: Sequence[ProviderMessage],
    temperature: float,
    top_p: float,
    max_tokens: int | None,
) -> str:
    """Hash of the canonical request. Only role+content are included, in order."""
    canonical = canonical_json(
        {
            "model": model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "temperature": float(temperature),
            "top_p": float(top_p),
            "max_tokens": max_tokens,
        }
    )
    return CACHE_PREFIX + hashlib.sha256(canonical.encode()).hexdigest()


async def get_cached(redis: Redis, key: str) -> dict[str, Any] | None:
    raw = await redis.get(key)
    if raw is None:
        return None
    value: dict[str, Any] = json.loads(raw)
    return value


async def set_cached(redis: Redis, key: str, value: dict[str, Any], ttl_seconds: int) -> None:
    await redis.set(key, json.dumps(value), ex=ttl_seconds)
