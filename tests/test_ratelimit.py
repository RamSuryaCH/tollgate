import uuid

import httpx
from redis.asyncio import Redis
from tests.conftest import bearer

from tollgate.ratelimit import consume_token


async def test_bucket_denies_when_empty_and_reports_retry(app) -> None:
    redis: Redis = app.state.redis
    key_id = uuid.uuid4()

    first = await consume_token(redis, key_id, rpm=2)
    second = await consume_token(redis, key_id, rpm=2)
    third = await consume_token(redis, key_id, rpm=2)

    assert first.allowed and first.remaining == 1
    assert second.allowed and second.remaining == 0
    assert not third.allowed
    assert third.retry_after >= 1


async def test_chat_returns_429_after_rpm_requests(client: httpx.AsyncClient, api_key: str) -> None:
    rpm = 10
    statuses = []
    retry_after = None
    for i in range(rpm + 1):
        resp = await client.post(
            "/v1/chat",
            json={"messages": [{"role": "user", "content": f"burst {i}"}], "stream": False},
            headers=bearer(api_key),
        )
        statuses.append(resp.status_code)
        if resp.status_code == 429:
            retry_after = resp.headers["Retry-After"]
            assert resp.json() == {"detail": "Rate limit exceeded"}

    assert statuses[:rpm] == [200] * rpm
    assert statuses[rpm] == 429
    assert retry_after is not None and retry_after.isdigit()
    assert int(retry_after) >= 1
