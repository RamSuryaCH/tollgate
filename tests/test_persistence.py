from datetime import UTC, datetime

import httpx
from sqlalchemy import text
from tests.conftest import bearer

from tollgate.providers.ollama import OllamaProvider


async def _rows(app, sql: str) -> list[tuple]:  # type: ignore[type-arg]
    async with app.state.engine.connect() as conn:
        return [tuple(r) for r in (await conn.execute(text(sql))).all()]


async def test_chat_persists_conversation_messages_log_and_rollup(
    client: httpx.AsyncClient, api_key: str, app
) -> None:
    resp = await client.post(
        "/v1/chat",
        json={"messages": [{"role": "user", "content": "hello there friend"}]},
        headers=bearer(api_key),
    )
    assert resp.status_code == 200
    body = resp.json()
    completion_tokens = body["usage"]["completion_tokens"]

    convs = await _rows(app, "SELECT title FROM conversations")
    assert convs == [("hello there friend",)]

    msgs = await _rows(app, "SELECT role, content FROM messages ORDER BY created_at")
    assert [m[0] for m in msgs] == ["user", "assistant"]
    assert msgs[0][1] == "hello there friend"
    assert msgs[1][1] == body["choices"][0]["message"]["content"]

    logs = await _rows(
        app,
        "SELECT status, cache_hit, prompt_tokens, completion_tokens, provider, model, "
        "conversation_id IS NOT NULL FROM request_logs",
    )
    assert logs == [(200, False, 3, completion_tokens, "mock", "llama3.2:3b", True)]

    daily = await _rows(
        app,
        "SELECT request_count, prompt_tokens, completion_tokens, cache_hits, cache_misses, "
        "error_count FROM usage_daily",
    )
    assert daily == [(1, 3, completion_tokens, 0, 1, 0)]

    last_used = await _rows(app, "SELECT last_used_at IS NOT NULL FROM api_keys")
    assert last_used == [(True,)]


async def test_cache_hit_logs_hit_and_rollup(client: httpx.AsyncClient, api_key: str, app) -> None:
    body = {"messages": [{"role": "user", "content": "repeat me"}], "temperature": 0}
    await client.post("/v1/chat", json=body, headers=bearer(api_key))
    second = await client.post("/v1/chat", json=body, headers=bearer(api_key))
    assert second.headers["X-Cache"] == "HIT"

    logs = await _rows(app, "SELECT cache_hit FROM request_logs ORDER BY created_at")
    assert logs == [(False,), (True,)]
    daily = await _rows(app, "SELECT request_count, cache_hits, cache_misses FROM usage_daily")
    assert daily == [(2, 1, 1)]


async def test_provider_down_logs_502_and_returns_502(
    client: httpx.AsyncClient, api_key: str, app
) -> None:
    # Port 9 (discard) refuses connections on this box, which simulates an Ollama outage.
    broken = OllamaProvider("http://127.0.0.1:9", timeout=2.0)
    previous = app.state.provider
    app.state.provider = broken
    try:
        resp = await client.post(
            "/v1/chat",
            json={"messages": [{"role": "user", "content": "anyone home"}]},
            headers=bearer(api_key),
        )
    finally:
        app.state.provider = previous
        await broken.aclose()

    assert resp.status_code == 502
    assert resp.json()["detail"]
    logs = await _rows(app, "SELECT status, error IS NOT NULL FROM request_logs")
    assert logs == [(502, True)]
    daily = await _rows(app, "SELECT error_count FROM usage_daily")
    assert daily == [(1,)]
    assert await _rows(app, "SELECT count(*) FROM messages") == [(0,)]


async def test_usage_summary_and_recent(
    client: httpx.AsyncClient, api_key: str, admin_headers
) -> None:
    body = {"messages": [{"role": "user", "content": "usage please"}], "temperature": 0}
    await client.post("/v1/chat", json=body, headers=bearer(api_key))
    await client.post("/v1/chat", json=body, headers=bearer(api_key))

    today = datetime.now(UTC).date().isoformat()
    summary = await client.get(
        "/v1/usage/summary", params={"from": today, "to": today}, headers=bearer(api_key)
    )
    assert summary.status_code == 200
    data = summary.json()
    assert data["requests"] == 2
    assert data["cache_hit_rate"] == 0.5
    assert isinstance(data["p95_latency_ms"], (int, float))
    assert data["errors"] == 0
    assert data["total_tokens"] == data["prompt_tokens"] + data["completion_tokens"]
    assert data["prompt_tokens"] == 2  # "usage please" is 2 words; the cache hit logs 0

    default_window = await client.get("/v1/usage/summary", headers=bearer(api_key))
    assert default_window.json()["requests"] == 2

    recent = await client.get("/v1/usage/recent", params={"limit": 5}, headers=bearer(api_key))
    assert recent.status_code == 200
    rows = recent.json()
    assert len(rows) == 2
    assert rows[0]["created_at"] >= rows[1]["created_at"]
    assert rows[0]["cache_hit"] is True
    assert rows[1]["cache_hit"] is False
    assert {"id", "model", "provider", "status", "latency_ms", "conversation_id"} <= rows[0].keys()

    admin_summary = await client.get(
        "/v1/usage/summary", params={"from": today, "to": today}, headers=admin_headers
    )
    assert admin_summary.json()["requests"] == 2


async def test_recent_limit_is_validated(client: httpx.AsyncClient, api_key: str) -> None:
    resp = await client.get("/v1/usage/recent", params={"limit": 500}, headers=bearer(api_key))
    assert resp.status_code == 422
