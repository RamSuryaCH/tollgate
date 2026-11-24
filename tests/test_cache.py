import httpx
from redis.asyncio import Redis
from tests.conftest import bearer

from tollgate.cache import CACHE_PREFIX, build_cache_key
from tollgate.providers.base import ProviderMessage

MSG = [{"role": "user", "content": "what is a token bucket?"}]


def _body(**overrides):  # type: ignore[no-untyped-def]
    body = {"messages": MSG, "temperature": 0}
    body.update(overrides)
    return body


async def test_identical_request_misses_then_hits(
    client: httpx.AsyncClient, api_key: str, app
) -> None:
    first = await client.post("/v1/chat", json=_body(), headers=bearer(api_key))
    second = await client.post("/v1/chat", json=_body(), headers=bearer(api_key))

    assert first.status_code == second.status_code == 200
    assert first.headers["X-Cache"] == "MISS"
    assert second.headers["X-Cache"] == "HIT"
    a, b = first.json(), second.json()
    assert a["choices"] == b["choices"]
    assert a["usage"] == b["usage"]
    assert a["id"] == b["id"]
    # Each response gets a conversation id; a HIT still persists its own turn.
    assert a["conversation_id"] != b["conversation_id"]

    redis: Redis = app.state.redis
    keys = [k async for k in redis.scan_iter(match=f"{CACHE_PREFIX}*")]
    assert len(keys) == 1
    assert 0 < await redis.ttl(keys[0]) <= 3600

    async with app.state.engine.connect() as conn:
        from sqlalchemy import text

        logs = await conn.execute(text("SELECT cache_hit FROM request_logs ORDER BY created_at"))
        assert [r[0] for r in logs] == [False, True]
        msgs = await conn.execute(text("SELECT count(*) FROM messages"))
        assert msgs.scalar_one() == 4


async def test_stream_is_never_cached_or_hit(client: httpx.AsyncClient, api_key: str) -> None:
    body = _body(stream=True)
    for _ in range(2):
        resp = await client.post("/v1/chat", json=body, headers=bearer(api_key))
        assert resp.status_code == 200
        assert resp.headers["X-Cache"] == "BYPASS"


async def test_nonzero_temperature_is_bypassed(client: httpx.AsyncClient, api_key: str) -> None:
    for _ in range(2):
        resp = await client.post("/v1/chat", json=_body(temperature=0.7), headers=bearer(api_key))
        assert resp.status_code == 200
        assert resp.headers["X-Cache"] == "BYPASS"


async def test_missing_temperature_counts_as_zero(client: httpx.AsyncClient, api_key: str) -> None:
    body = {"messages": MSG}
    first = await client.post("/v1/chat", json=body, headers=bearer(api_key))
    second = await client.post("/v1/chat", json=body, headers=bearer(api_key))
    assert first.headers["X-Cache"] == "MISS"
    assert second.headers["X-Cache"] == "HIT"


async def test_key_with_cache_disabled_never_hits(client: httpx.AsyncClient, make_key) -> None:
    _, token = await make_key(name="no-cache", cache_enabled=False)
    for _ in range(2):
        resp = await client.post("/v1/chat", json=_body(), headers=bearer(token))
        assert resp.status_code == 200
        assert resp.headers["X-Cache"] == "BYPASS"


def test_cache_key_is_order_stable_and_sensitive_to_inputs() -> None:
    msgs = (ProviderMessage("user", "hi"),)
    base = build_cache_key(model="m", messages=msgs, temperature=0, top_p=1, max_tokens=None)
    same = build_cache_key(model="m", messages=msgs, temperature=0.0, top_p=1.0, max_tokens=None)
    other_model = build_cache_key(model="n", messages=msgs, temperature=0, top_p=1, max_tokens=None)
    other_tokens = build_cache_key(model="m", messages=msgs, temperature=0, top_p=1, max_tokens=5)
    assert base == same
    assert base != other_model
    assert base != other_tokens
    assert base.startswith(CACHE_PREFIX)
