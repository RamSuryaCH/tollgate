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


async def test_cors_preflight_and_exposed_cache_header(client):
    preflight = await client.options(
        "/healthz",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert preflight.status_code in {200, 204}
    assert "http://localhost:3000" in preflight.headers.get("access-control-allow-origin", "")

    response = await client.get("/healthz", headers={"Origin": "http://localhost:3000"})
    assert response.status_code == 200
    expose = response.headers.get("access-control-expose-headers", "").lower()
    assert "x-cache" in expose
