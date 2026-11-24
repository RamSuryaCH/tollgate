import json

import httpx
from tests.conftest import bearer

from tollgate.providers import ProviderMessage, ProviderRequest
from tollgate.providers.ollama import OllamaProvider


def _parse_sse(raw: str) -> list[str]:
    events = []
    for block in raw.split("\n\n"):
        block = block.strip()
        if block.startswith("data:"):
            events.append(block[len("data:") :].strip())
    return events


async def test_stream_reconstructs_mock_reply(client: httpx.AsyncClient, api_key: str) -> None:
    body = {"messages": [{"role": "user", "content": "stream me please"}], "stream": True}
    expected = (
        await client.post(
            "/v1/chat",
            json={"messages": body["messages"]},
            headers=bearer(api_key),
        )
    ).json()["choices"][0]["message"]["content"]

    resp = await client.post("/v1/chat", json=body, headers=bearer(api_key))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")

    events = _parse_sse(resp.text)
    assert events[-1] == "[DONE]"
    chunks = [json.loads(e) for e in events[:-1]]
    assert all(c["object"] == "chat.completion.chunk" for c in chunks)
    assert chunks[0]["conversation_id"]
    text = "".join(c["choices"][0]["delta"].get("content", "") for c in chunks)
    assert text == expected
    assert chunks[-1]["choices"][0]["finish_reason"] == "stop"


async def test_ollama_stream_parses_ndjson() -> None:
    lines = [
        {"message": {"role": "assistant", "content": "Hel"}, "done": False},
        {"message": {"role": "assistant", "content": "lo"}, "done": False},
        {
            "message": {"role": "assistant", "content": ""},
            "done": True,
            "done_reason": "stop",
            "prompt_eval_count": 7,
            "eval_count": 2,
        },
    ]
    payload = "\n".join(json.dumps(x) for x in lines) + "\n"

    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["stream"] is True
        return httpx.Response(200, content=payload.encode())

    provider = OllamaProvider(
        "http://ollama.test", client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )
    req = ProviderRequest("m", (ProviderMessage("user", "hi"),), 0, 1, None)
    chunks = [c async for c in provider.stream(req)]
    assert "".join(c.text for c in chunks) == "Hello"
    final = chunks[-1]
    assert final.finish_reason == "stop"
    assert (final.prompt_tokens, final.completion_tokens) == (7, 2)
    await provider.aclose()
