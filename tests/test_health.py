import httpx
from fastapi import FastAPI


async def test_healthz_ok(client: httpx.AsyncClient) -> None:
    resp = await client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "postgres": "ok", "redis": "ok"}


async def test_healthz_reports_redis_down_without_raising(
    app: FastAPI, client: httpx.AsyncClient, monkeypatch
) -> None:
    async def down() -> bool:
        raise ConnectionError("redis is down")

    monkeypatch.setattr(app.state.redis, "ping", down)
    resp = await client.get("/healthz")
    assert resp.status_code == 503
    assert resp.json()["redis"] == "error"
    assert resp.json()["postgres"] == "ok"
