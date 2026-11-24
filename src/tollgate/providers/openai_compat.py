"""OpenAI-compatible provider: POST {base}/chat/completions. Only used when configured."""

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from tollgate.providers.base import (
    ProviderChunk,
    ProviderError,
    ProviderRequest,
    ProviderResponse,
    estimate_completion_tokens,
    estimate_prompt_tokens,
)

DEFAULT_TIMEOUT_SECONDS = 120.0


class OpenAICompatProvider:
    name = "openai"

    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._url = f"{base_url.rstrip('/')}/chat/completions"
        self._headers = {"Authorization": f"Bearer {api_key}"}
        self._client = client or httpx.AsyncClient(timeout=timeout)

    def _payload(self, request: ProviderRequest, *, stream: bool) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": request.model,
            "messages": [{"role": m.role, "content": m.content} for m in request.messages],
            "temperature": request.temperature,
            "top_p": request.top_p,
            "stream": stream,
        }
        if request.max_tokens is not None:
            body["max_tokens"] = request.max_tokens
        return body

    async def complete(self, request: ProviderRequest) -> ProviderResponse:
        try:
            resp = await self._client.post(
                self._url, json=self._payload(request, stream=False), headers=self._headers
            )
            resp.raise_for_status()
            data = resp.json()
            choice = data["choices"][0]
            content = str(choice["message"]["content"] or "")
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as exc:
            raise ProviderError(f"openai request failed: {exc}") from exc
        usage = data.get("usage") or {}
        prompt = usage.get("prompt_tokens")
        completion = usage.get("completion_tokens")
        return ProviderResponse(
            model=request.model,
            content=content,
            prompt_tokens=int(prompt)
            if prompt is not None
            else estimate_prompt_tokens(request.messages),
            completion_tokens=int(completion)
            if completion is not None
            else estimate_completion_tokens(content),
            finish_reason=str(choice.get("finish_reason") or "stop"),
        )

    async def stream(self, request: ProviderRequest) -> AsyncIterator[ProviderChunk]:
        try:
            async with self._client.stream(
                "POST",
                self._url,
                json=self._payload(request, stream=True),
                headers=self._headers,
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[len("data:") :].strip()
                    if payload == "[DONE]":
                        return
                    obj = json.loads(payload)
                    choice = obj["choices"][0]
                    text = str(choice.get("delta", {}).get("content") or "")
                    finish = choice.get("finish_reason")
                    yield ProviderChunk(text=text, finish_reason=finish)
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as exc:
            raise ProviderError(f"openai stream failed: {exc}") from exc

    async def aclose(self) -> None:
        await self._client.aclose()
