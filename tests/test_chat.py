import httpx
from tests.conftest import bearer

from tollgate.providers import ProviderMessage, ProviderRequest
from tollgate.providers.mock import MockProvider
from tollgate.providers.ollama import OllamaProvider


async def test_nonstream_completion_shape(client: httpx.AsyncClient, api_key: str) -> None:
    resp = await client.post(
        "/v1/chat",
        json={"messages": [{"role": "user", "content": "hello there friend"}]},
        headers=bearer(api_key),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["object"] == "chat.completion"
    assert body["id"].startswith("chatcmpl-")
    assert isinstance(body["created"], int)
    assert body["model"] == "llama3.2:3b"
    choice = body["choices"][0]
    assert choice["index"] == 0
    assert choice["message"]["role"] == "assistant"
    assert choice["message"]["content"].startswith("mock-reply: ")
    assert choice["finish_reason"] == "stop"
    usage = body["usage"]
    assert usage["prompt_tokens"] == 3
    assert usage["completion_tokens"] == len(choice["message"]["content"].split())
    assert usage["total_tokens"] == usage["prompt_tokens"] + usage["completion_tokens"]
    assert body["conversation_id"]


async def test_mock_reply_is_deterministic() -> None:
    req = ProviderRequest(
        model="m",
        messages=(ProviderMessage("user", "same input"),),
        temperature=0,
        top_p=1,
        max_tokens=None,
    )
    a = await MockProvider().complete(req)
    b = await MockProvider().complete(req)
    assert a == b


async def test_second_request_continues_conversation(
    client: httpx.AsyncClient, api_key: str
) -> None:
    first = await client.post(
        "/v1/chat",
        json={"messages": [{"role": "user", "content": "first turn"}]},
        headers=bearer(api_key),
    )
    conv = first.json()["conversation_id"]
    second = await client.post(
        "/v1/chat",
        json={
            "conversation_id": conv,
            "messages": [{"role": "user", "content": "second turn"}],
            "temperature": 0.5,
        },
        headers=bearer(api_key),
    )
    assert second.status_code == 200
    assert second.json()["conversation_id"] == conv


async def test_unknown_conversation_is_404(client: httpx.AsyncClient, api_key: str) -> None:
    resp = await client.post(
        "/v1/chat",
        json={
            "conversation_id": "00000000-0000-0000-0000-000000000001",
            "messages": [{"role": "user", "content": "hi"}],
        },
        headers=bearer(api_key),
    )
    assert resp.status_code == 404


async def test_other_keys_conversation_is_404(
    client: httpx.AsyncClient, api_key: str, make_key
) -> None:
    _, other_token = await make_key(name="other")
    first = await client.post(
        "/v1/chat",
        json={"messages": [{"role": "user", "content": "mine"}]},
        headers=bearer(api_key),
    )
    conv = first.json()["conversation_id"]
    resp = await client.post(
        "/v1/chat",
        json={"conversation_id": conv, "messages": [{"role": "user", "content": "theirs"}]},
        headers=bearer(other_token),
    )
    assert resp.status_code == 404


async def test_empty_messages_is_422(client: httpx.AsyncClient, api_key: str) -> None:
    resp = await client.post("/v1/chat", json={"messages": []}, headers=bearer(api_key))
    assert resp.status_code == 422


async def test_ollama_complete_maps_counts_and_content() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/chat"
        assert b'"stream":false' in request.content
        return httpx.Response(
            200,
            json={
                "message": {"role": "assistant", "content": "hi back"},
                "prompt_eval_count": 11,
                "eval_count": 2,
                "done_reason": "stop",
            },
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = OllamaProvider("http://ollama.test", client=client)
    req = ProviderRequest("llama3.2:3b", (ProviderMessage("user", "hello"),), 0, 1, 16)
    out = await provider.complete(req)
    assert out.content == "hi back"
    assert (out.prompt_tokens, out.completion_tokens) == (11, 2)
    await provider.aclose()
