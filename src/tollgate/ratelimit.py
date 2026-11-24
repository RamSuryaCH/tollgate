"""Per-API-key token bucket. The refill and consume happen atomically in one Lua script."""

import uuid
from dataclasses import dataclass

from redis.asyncio import Redis

RATE_LIMIT_PREFIX = "tollgate:rl:"

# Bucket state lives in a hash: tokens (float), ts (last update, seconds from Redis TIME).
# Returns {allowed (0/1), remaining tokens (floor), retry_after seconds (ceil, 0 if allowed)}.
_TOKEN_BUCKET_LUA = """
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])

local t = redis.call('TIME')
local now = tonumber(t[1]) + tonumber(t[2]) / 1000000

local state = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts = tonumber(state[2])
if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end

local elapsed = math.max(0, now - ts)
tokens = math.min(capacity, tokens + elapsed * refill)

local allowed = 0
local retry_after = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry_after = math.ceil((cost - tokens) / refill)
end

redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', key, 120)
return {allowed, math.floor(tokens), retry_after}
"""


@dataclass(frozen=True)
class RateDecision:
    allowed: bool
    remaining: int
    retry_after: int


async def consume_token(redis: Redis, api_key_id: uuid.UUID, rpm: int) -> RateDecision:
    """Take one token from the key's bucket. Capacity is rpm, refill is rpm per 60 seconds.

    Raises redis.exceptions.RedisError when Redis is unreachable. Callers must fail closed.
    """
    script = redis.register_script(_TOKEN_BUCKET_LUA)
    result = await script(
        keys=[f"{RATE_LIMIT_PREFIX}{api_key_id}"],
        args=[rpm, repr(rpm / 60.0), 1],
    )
    allowed, remaining, retry_after = (int(v) for v in result)
    return RateDecision(allowed=bool(allowed), remaining=remaining, retry_after=retry_after)
