"""Provider protocol and shared data types."""

import json
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class ProviderMessage:
    role: str
    content: str


@dataclass(frozen=True)
class ProviderRequest:
    model: str
    messages: tuple[ProviderMessage, ...]
    temperature: float
    top_p: float
    max_tokens: int | None


@dataclass(frozen=True)
class ProviderResponse:
    model: str
    content: str
    prompt_tokens: int
    completion_tokens: int
    finish_reason: str = "stop"


@dataclass(frozen=True)
class ProviderChunk:
    text: str = ""
    finish_reason: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class ProviderError(Exception):
    """The upstream model call failed (network error, timeout, bad response)."""


class ProviderUnavailable(Exception):
    """The configured provider cannot be used (missing URL or key)."""


class ChatProvider(Protocol):
    name: str

    async def complete(self, request: ProviderRequest) -> ProviderResponse: ...

    def stream(self, request: ProviderRequest) -> AsyncIterator[ProviderChunk]: ...

    async def aclose(self) -> None: ...


def canonical_json(obj: Any) -> str:
    """Deterministic JSON: sorted keys, no whitespace, UTF-8 text kept as-is."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def count_words(texts: Sequence[str]) -> int:
    return sum(len(t.split()) for t in texts)


def estimate_prompt_tokens(messages: Sequence[ProviderMessage]) -> int:
    """Whitespace-word heuristic used when a provider does not report token counts."""
    return max(1, count_words([m.content for m in messages]))


def estimate_completion_tokens(text: str) -> int:
    return max(1, count_words([text]))
