"""POST /v1/chat: auth, rate limit, cache, provider call, streaming, and persistence.

Cache policy: only non-stream requests with temperature 0 on a key with cache_enabled are
cacheable. Other requests get X-Cache: BYPASS (they are never looked up or stored).
"""

import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tollgate.api.deps import ApiKeyDep, ProviderDep, RedisDep, SettingsDep
from tollgate.cache import build_cache_key, get_cached, set_cached
from tollgate.config import Settings
from tollgate.db import get_session_factory
from tollgate.models import ApiKey, Conversation
from tollgate.providers import (
    ChatProvider,
    ProviderChunk,
    ProviderError,
    ProviderMessage,
    ProviderRequest,
)
from tollgate.providers.base import estimate_completion_tokens, estimate_prompt_tokens
from tollgate.ratelimit import consume_token
from tollgate.schemas import ChatMessageIn, ChatRequest
from tollgate.usage import (
    CacheState,
    RequestRecord,
    Turn,
    create_conversation,
    record_request,
)

router = APIRouter(prefix="/v1", tags=["chat"])
log = logging.getLogger(__name__)

UPSTREAM_ERROR_DETAIL = "Model provider unavailable"
CLIENT_CLOSED_STATUS = 499
_ERROR_TEXT_LIMIT = 500


@dataclass
class _Attempt:
    """Everything a single /v1/chat call needs once auth has passed."""

    factory: async_sessionmaker[AsyncSession]
    api_key: ApiKey
    settings: Settings
    provider: ChatProvider
    redis: Redis
    started: float
    model: str
    messages: tuple[ProviderMessage, ...]
    user_text: str | None

    def elapsed_ms(self) -> int:
        return int((time.perf_counter() - self.started) * 1000)


def _last_user_text(messages: list[ChatMessageIn]) -> str | None:
    for m in reversed(messages):
        if m.role == "user":
            return m.content
    return None


def _completion_payload(
    model: str, content: str, prompt_tokens: int, completion_tokens: int, finish_reason: str
) -> dict[str, Any]:
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": finish_reason,
            }
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
    }


def _require_id(conversation_id: uuid.UUID | None) -> uuid.UUID:
    """record_request returns an id for every successful request."""
    if conversation_id is None:
        raise RuntimeError("successful request did not produce a conversation id")
    return conversation_id


def _turn(user_text: str | None, assistant_text: str) -> Turn | None:
    return Turn(user_text=user_text, assistant_text=assistant_text) if user_text else None


async def _record_failure(
    att: _Attempt,
    *,
    status: int,
    error: str,
    conversation_id: uuid.UUID | None,
    cache_state: CacheState = "BYPASS",
) -> None:
    await record_request(
        att.factory,
        RequestRecord(
            api_key_id=att.api_key.id,
            provider=att.provider.name,
            model=att.model,
            status=status,
            latency_ms=att.elapsed_ms(),
            cache_state=cache_state,
            error=error,
            conversation_id=conversation_id,
        ),
    )


async def _cache_get(redis: Redis, key: str) -> dict[str, Any] | None:
    try:
        return await get_cached(redis, key)
    except (RedisError, ValueError) as exc:
        log.warning("cache read failed, treating as miss: %s", exc)
        return None


async def _cache_set(redis: Redis, key: str, payload: dict[str, Any], ttl: int) -> None:
    try:
        await set_cached(redis, key, payload, ttl)
    except RedisError as exc:
        log.warning("cache write failed: %s", exc)


@router.post("/chat")
async def create_chat(
    body: ChatRequest,
    request: Request,
    api_key: ApiKeyDep,
    redis: RedisDep,
    settings: SettingsDep,
    provider: ProviderDep,
) -> Response:
    started = time.perf_counter()
    att = _Attempt(
        factory=get_session_factory(request),
        api_key=api_key,
        settings=settings,
        provider=provider,
        redis=redis,
        started=started,
        model=body.model or settings.default_model,
        messages=tuple(ProviderMessage(m.role, m.content) for m in body.messages),
        user_text=_last_user_text(body.messages),
    )

    # 1. Rate limit. Fail closed when Redis is down: never let unlimited traffic through.
    try:
        decision = await consume_token(redis, api_key.id, api_key.rate_limit_rpm)
    except RedisError as exc:
        log.error("rate limiter unavailable: %s", exc)
        await _record_failure(
            att, status=503, error="rate limiter unavailable", conversation_id=None
        )
        raise HTTPException(status_code=503, detail="Rate limiter unavailable") from exc
    if not decision.allowed:
        await _record_failure(att, status=429, error="rate limited", conversation_id=None)
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded",
            headers={"Retry-After": str(max(1, decision.retry_after))},
        )

    # 2. Resolve an existing conversation. It must belong to this key.
    if body.conversation_id is not None:
        async with att.factory() as session:
            owned = await session.scalar(
                select(Conversation.id).where(
                    Conversation.id == body.conversation_id,
                    Conversation.api_key_id == api_key.id,
                )
            )
        if owned is None:
            await _record_failure(
                att, status=404, error="conversation not found", conversation_id=None
            )
            raise HTTPException(status_code=404, detail="Conversation not found")

    cacheable = not body.stream and body.temperature == 0 and api_key.cache_enabled
    cache_key: str | None = None
    if cacheable:
        cache_key = build_cache_key(
            model=att.model,
            messages=att.messages,
            temperature=body.temperature,
            top_p=body.top_p,
            max_tokens=body.max_tokens,
        )
        cached = await _cache_get(redis, cache_key)
        if cached is not None:
            return await _serve_hit(att, body, cached)

    if body.stream:
        return await _stream(att, body)

    return await _complete(att, body, cache_key)


async def _serve_hit(att: _Attempt, body: ChatRequest, cached: dict[str, Any]) -> Response:
    content = str(cached["choices"][0]["message"]["content"])
    conversation_id = await record_request(
        att.factory,
        RequestRecord(
            api_key_id=att.api_key.id,
            provider=att.provider.name,
            model=att.model,
            status=200,
            latency_ms=att.elapsed_ms(),
            cache_state="HIT",
            conversation_id=body.conversation_id,
            turn=_turn(att.user_text, content),
        ),
    )
    payload = {**cached, "conversation_id": str(_require_id(conversation_id))}
    return JSONResponse(payload, headers={"X-Cache": "HIT"})


async def _complete(att: _Attempt, body: ChatRequest, cache_key: str | None) -> Response:
    state: CacheState = "MISS" if cache_key is not None else "BYPASS"
    request = ProviderRequest(
        model=att.model,
        messages=att.messages,
        temperature=body.temperature,
        top_p=body.top_p,
        max_tokens=body.max_tokens,
    )
    try:
        result = await att.provider.complete(request)
    except ProviderError as exc:
        log.warning("provider call failed: %s", exc)
        await _record_failure(
            att,
            status=502,
            error=str(exc)[:_ERROR_TEXT_LIMIT],
            conversation_id=body.conversation_id,
            cache_state=state,
        )
        raise HTTPException(status_code=502, detail=UPSTREAM_ERROR_DETAIL) from exc

    payload = _completion_payload(
        att.model,
        result.content,
        result.prompt_tokens,
        result.completion_tokens,
        result.finish_reason,
    )
    conversation_id = await record_request(
        att.factory,
        RequestRecord(
            api_key_id=att.api_key.id,
            provider=att.provider.name,
            model=att.model,
            status=200,
            latency_ms=att.elapsed_ms(),
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
            cache_state=state,
            conversation_id=body.conversation_id,
            turn=_turn(att.user_text, result.content),
        ),
    )
    if cache_key is not None:
        await _cache_set(att.redis, cache_key, payload, att.settings.cache_ttl_seconds)
    return JSONResponse(
        {**payload, "conversation_id": str(_require_id(conversation_id))},
        headers={"X-Cache": state},
    )


async def _stream(att: _Attempt, body: ChatRequest) -> Response:
    request = ProviderRequest(
        model=att.model,
        messages=att.messages,
        temperature=body.temperature,
        top_p=body.top_p,
        max_tokens=body.max_tokens,
    )
    chunks = att.provider.stream(request)
    # Fetch the first chunk before responding so an unreachable provider returns a real 502.
    try:
        first: ProviderChunk | None = await anext(chunks, None)
    except ProviderError as exc:
        log.warning("provider stream failed to start: %s", exc)
        await _record_failure(
            att,
            status=502,
            error=str(exc)[:_ERROR_TEXT_LIMIT],
            conversation_id=body.conversation_id,
        )
        raise HTTPException(status_code=502, detail=UPSTREAM_ERROR_DETAIL) from exc

    conversation_id = body.conversation_id
    if conversation_id is None:
        conversation_id = await create_conversation(att.factory, att.api_key.id, att.user_text)
    return StreamingResponse(
        _sse_events(att, body, chunks, first, conversation_id),
        media_type="text/event-stream",
        headers={"X-Cache": "BYPASS", "Cache-Control": "no-cache"},
    )


async def _chain(
    first: ProviderChunk | None, rest: AsyncIterator[ProviderChunk]
) -> AsyncIterator[ProviderChunk]:
    if first is not None:
        yield first
    async for chunk in rest:
        yield chunk


async def _sse_events(
    att: _Attempt,
    body: ChatRequest,
    chunks: AsyncIterator[ProviderChunk],
    first: ProviderChunk | None,
    conversation_id: uuid.UUID,
) -> AsyncIterator[str]:
    completion_id = f"chatcmpl-{uuid.uuid4().hex}"
    created = int(time.time())
    parts: list[str] = []
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    finish_reason = "stop"
    status = CLIENT_CLOSED_STATUS
    error: str | None = None

    def frame(delta: dict[str, Any], finish: str | None = None) -> str:
        obj = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": att.model,
            "conversation_id": str(conversation_id),
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
        }
        return f"data: {json.dumps(obj)}\n\n"

    try:
        yield frame({"role": "assistant"})
        async for chunk in _chain(first, chunks):
            if chunk.text:
                parts.append(chunk.text)
                yield frame({"content": chunk.text})
            if chunk.finish_reason:
                finish_reason = chunk.finish_reason
            if chunk.prompt_tokens is not None:
                prompt_tokens = chunk.prompt_tokens
            if chunk.completion_tokens is not None:
                completion_tokens = chunk.completion_tokens
        yield frame({}, finish_reason)
        status = 200
        yield "data: [DONE]\n\n"
    except ProviderError as exc:
        log.warning("provider stream failed mid-response: %s", exc)
        status = 502
        error = str(exc)[:_ERROR_TEXT_LIMIT]
        err = {"error": {"message": UPSTREAM_ERROR_DETAIL, "type": "upstream_error"}}
        yield f"data: {json.dumps(err)}\n\n"
        yield "data: [DONE]\n\n"
    finally:
        text = "".join(parts)
        close = getattr(chunks, "aclose", None)
        if close is not None:
            await close()
        await record_request(
            att.factory,
            RequestRecord(
                api_key_id=att.api_key.id,
                provider=att.provider.name,
                model=att.model,
                status=status,
                latency_ms=att.elapsed_ms(),
                prompt_tokens=(
                    prompt_tokens
                    if prompt_tokens is not None
                    else estimate_prompt_tokens(att.messages)
                ),
                completion_tokens=(
                    completion_tokens
                    if completion_tokens is not None
                    else estimate_completion_tokens(text)
                ),
                cache_state="BYPASS",
                error=error,
                conversation_id=conversation_id,
                turn=_turn(att.user_text, text) if status == 200 else None,
            ),
        )
