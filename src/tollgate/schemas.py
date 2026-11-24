"""Request and response models for the HTTP API."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

Role = Literal["system", "user", "assistant"]


class ChatMessageIn(BaseModel):
    role: Role
    content: str = Field(max_length=100_000)


class ChatRequest(BaseModel):
    model: str | None = Field(default=None, min_length=1, max_length=200)
    messages: list[ChatMessageIn] = Field(min_length=1, max_length=500)
    temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    top_p: float = Field(default=1.0, gt=0.0, le=1.0)
    max_tokens: int | None = Field(default=None, ge=1, le=32_768)
    stream: bool = False
    conversation_id: UUID | None = None


class KeyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    rate_limit_rpm: int | None = Field(default=None, ge=1, le=100_000)
    cache_enabled: bool = True


class KeyOut(BaseModel):
    id: UUID
    name: str
    prefix: str
    rate_limit_rpm: int
    cache_enabled: bool
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None


class KeyCreated(BaseModel):
    id: UUID
    name: str
    prefix: str
    key: str = Field(description="Full plaintext key. Shown only in this response.")
    rate_limit_rpm: int
    cache_enabled: bool
    created_at: datetime


class UsageSummary(BaseModel):
    requests: int
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cache_hit_rate: float = Field(description="Fraction of requests served from cache, 0..1.")
    p95_latency_ms: float | None = Field(
        description="95th percentile of request_logs.latency_ms. Null when there are no requests."
    )
    errors: int = Field(description="Requests with status >= 400.")


class UsageRow(BaseModel):
    id: UUID
    created_at: datetime
    model: str
    provider: str
    status: int
    latency_ms: int
    prompt_tokens: int
    completion_tokens: int
    cache_hit: bool
    conversation_id: UUID | None


class DateRange(BaseModel):
    start: date
    end: date
