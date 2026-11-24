"""Ollama provider: POST {base}/api/chat, non-streaming and NDJSON streaming."""

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


class OllamaProvider:
    name = "ollama"

    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._client = client or httpx.AsyncClient(timeout=timeout)

    def _payload(self, request: ProviderRequest, *, stream: bool) -> dict[str, Any]:
        options: dict[str, Any] = {"temperature": request.temperature, "top_p": request.top_p}
        if request.max_tokens is not None:
            options["num_predict"] = request.max_tokens
        return {
            "model": request.model,
            "messages": [{"role": m.role, "content": m.content} for m in request.messages],
            "stream": stream,
            "options": options,
        }

    async def complete(self, request: ProviderRequest) -> ProviderResponse:
        try:
            resp = await self._client.post(
                f"{self._base}/api/chat", json=self._payload(request, stream=False)
            )
            resp.raise_for_status()
            data = resp.json()
            content = str(data["message"]["content"])
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise ProviderError(f"ollama request failed: {exc}") from exc
        completion = data.get("eval_count")
        prompt = data.get("prompt_eval_count")
        return ProviderResponse(
            model=request.model,
            content=content,
            prompt_tokens=int(prompt)
            if prompt is not None
            else estimate_prompt_tokens(request.messages),
            completion_tokens=int(completion)
            if completion is not None
            else estimate_completion_tokens(content),
            finish_reason=_finish_reason(data),
        )

    async def stream(self, request: ProviderRequest) -> AsyncIterator[ProviderChunk]:
        try:
            async with self._client.stream(
                "POST", f"{self._base}/api/chat", json=self._payload(request, stream=True)
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    data = json.loads(line)
                    text = str(data.get("message", {}).get("content", ""))
                    if data.get("done"):
                        yield ProviderChunk(
                            text=text,
                            finish_reason=_finish_reason(data),
                            prompt_tokens=_opt_int(data.get("prompt_eval_count")),
                            completion_tokens=_opt_int(data.get("eval_count")),
                        )
                        return
                    if text:
                        yield ProviderChunk(text=text)
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError(f"ollama stream failed: {exc}") from exc

    async def aclose(self) -> None:
        await self._client.aclose()


def _finish_reason(data: dict[str, Any]) -> str:
    return "length" if data.get("done_reason") == "length" else "stop"


def _opt_int(value: Any) -> int | None:
    return int(value) if value is not None else None
