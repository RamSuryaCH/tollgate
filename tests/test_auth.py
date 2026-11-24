import httpx
from tests.conftest import ADMIN_KEY, bearer

CHAT_BODY = {"messages": [{"role": "user", "content": "hello auth"}]}


async def test_missing_key_is_401(client: httpx.AsyncClient) -> None:
    resp = await client.post("/v1/chat", json=CHAT_BODY)
    assert resp.status_code == 401
    assert "detail" in resp.json()


async def test_invalid_key_is_401(client: httpx.AsyncClient) -> None:
    resp = await client.post("/v1/chat", json=CHAT_BODY, headers=bearer("tg_not_a_real_key"))
    assert resp.status_code == 401


async def test_admin_key_cannot_call_chat(client: httpx.AsyncClient) -> None:
    resp = await client.post("/v1/chat", json=CHAT_BODY, headers=bearer(ADMIN_KEY))
    assert resp.status_code == 401


async def test_revoked_key_is_401(client: httpx.AsyncClient, admin_headers) -> None:
    created = await client.post("/v1/admin/keys", json={"name": "to-revoke"}, headers=admin_headers)
    assert created.status_code == 201
    body = created.json()

    ok = await client.post("/v1/chat", json=CHAT_BODY, headers=bearer(body["key"]))
    assert ok.status_code == 200

    revoked = await client.post(f"/v1/keys/{body['id']}/revoke", headers=admin_headers)
    assert revoked.status_code == 200
    assert revoked.json()["revoked_at"] is not None

    denied = await client.post("/v1/chat", json=CHAT_BODY, headers=bearer(body["key"]))
    assert denied.status_code == 401


async def test_admin_create_and_list_keys(client: httpx.AsyncClient, admin_headers) -> None:
    resp = await client.post(
        "/v1/admin/keys",
        json={"name": "local-dev", "rate_limit_rpm": 60, "cache_enabled": True},
        headers=admin_headers,
    )
    assert resp.status_code == 201
    created = resp.json()
    assert created["key"].startswith("tg_")
    assert len(created["key"]) >= 3 + 32
    assert created["prefix"] == created["key"][:10]

    listed = await client.get("/v1/keys", headers=admin_headers)
    assert listed.status_code == 200
    rows = listed.json()
    assert [r["id"] for r in rows] == [created["id"]]
    assert "key" not in rows[0]
    assert "key_hash" not in rows[0]


async def test_admin_endpoint_rejects_wrong_key(client: httpx.AsyncClient) -> None:
    resp = await client.post("/v1/admin/keys", json={"name": "x"}, headers={"X-Admin-Key": "wrong"})
    assert resp.status_code == 401


async def test_user_lists_only_own_key(client: httpx.AsyncClient, admin_headers, make_key) -> None:
    _, mine = await make_key(name="mine")
    await make_key(name="theirs")

    resp = await client.get("/v1/keys", headers=bearer(mine))
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["name"] == "mine"
