"""Deterministic mock provider. No network, no model. Used by tests and DEFAULT_PROVIDER=mock."""

import hashlib
from collections.abc import AsyncIterator

from tollgate.providers.base import (
    ProviderChunk,
    ProviderRequest,
    ProviderResponse,
    canonical_json,
    estimate_completion_tokens,
    estimate_prompt_tokens,
)

_ECHO_CHARS = 40
_STREAM_CHUNK_CHARS = 4


class MockProvider:
    name = "mock"

    @staticmethod
    def reply_text(request: ProviderRequest) -> tuple[str, str]:
        """Return (reply, finish_reason). The same request always yields the same reply."""
        canonical = canonical_json(
            {
                "model": request.model,
                "messages": [{"role": m.role, "content": m.content} for m in request.messages],
                "temperature": request.temperature,
                "top_p": request.top_p,
                "max_tokens": request.max_tokens,
            }
        )
        digest = hashlib.sha256(canonical.encode()).hexdigest()[:16]
        last_user = next((m.content for m in reversed(request.messages) if m.role == "user"), "")
        echo = " ".join(last_user.split())[:_ECHO_CHARS]
        text = f"mock-reply: {digest} echo: {echo}"
        words = text.split()
        if request.max_tokens is not None and len(words) > request.max_tokens:
            return " ".join(words[: request.max_tokens]), "length"
        return text, "stop"

    async def complete(self, request: ProviderRequest) -> ProviderResponse:
        text, finish = self.reply_text(request)
        return ProviderResponse(
            model=request.model,
            content=text,
            prompt_tokens=estimate_prompt_tokens(request.messages),
            completion_tokens=estimate_completion_tokens(text),
            finish_reason=finish,
        )

    async def stream(self, request: ProviderRequest) -> AsyncIterator[ProviderChunk]:
        text, finish = self.reply_text(request)
        for i in range(0, len(text), _STREAM_CHUNK_CHARS):
            yield ProviderChunk(text=text[i : i + _STREAM_CHUNK_CHARS])
        yield ProviderChunk(
            finish_reason=finish,
            prompt_tokens=estimate_prompt_tokens(request.messages),
            completion_tokens=estimate_completion_tokens(text),
        )

    async def aclose(self) -> None:
        return None
