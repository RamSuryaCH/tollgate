"""Persistence for conversations, request logs, and daily usage rollups, plus usage queries."""

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Literal

from sqlalchemy import ColumnElement, case, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tollgate.models import Conversation, Message, RequestLog, UsageDaily

CacheState = Literal["HIT", "MISS", "BYPASS"]
TITLE_MAX_CHARS = 60


@dataclass(frozen=True)
class Turn:
    """One exchange to persist: the user's latest message and the assistant reply."""

    user_text: str
    assistant_text: str


@dataclass
class RequestRecord:
    api_key_id: uuid.UUID
    provider: str
    model: str
    status: int
    latency_ms: int
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cache_state: CacheState = "BYPASS"
    error: str | None = None
    conversation_id: uuid.UUID | None = None
    turn: Turn | None = None


def _title(text: str | None) -> str | None:
    if not text:
        return None
    return " ".join(text.split())[:TITLE_MAX_CHARS] or None


async def create_conversation(
    factory: async_sessionmaker[AsyncSession], api_key_id: uuid.UUID, first_user_text: str | None
) -> uuid.UUID:
    async with factory() as session, session.begin():
        conv = Conversation(api_key_id=api_key_id, title=_title(first_user_text))
        session.add(conv)
        await session.flush()
        return conv.id


async def record_request(
    factory: async_sessionmaker[AsyncSession], rec: RequestRecord
) -> uuid.UUID | None:
    """Write one request_logs row and upsert usage_daily in one transaction.

    On success (status < 400) it also creates a conversation when none is given, and stores
    the turn's messages. Returns the conversation id for successful requests, else None.
    """
    now = datetime.now(UTC)
    succeeded = rec.status < 400
    async with factory() as session, session.begin():
        conversation_id = rec.conversation_id
        if succeeded:
            if conversation_id is None:
                conv = Conversation(
                    api_key_id=rec.api_key_id,
                    title=_title(rec.turn.user_text if rec.turn else None),
                )
                session.add(conv)
                await session.flush()
                conversation_id = conv.id
            else:
                await session.execute(
                    update(Conversation)
                    .where(Conversation.id == conversation_id)
                    .values(updated_at=now)
                )
            if rec.turn is not None:
                session.add_all(
                    [
                        Message(
                            conversation_id=conversation_id,
                            role="user",
                            content=rec.turn.user_text,
                            created_at=now,
                        ),
                        Message(
                            conversation_id=conversation_id,
                            role="assistant",
                            content=rec.turn.assistant_text,
                            created_at=now + timedelta(microseconds=1),
                        ),
                    ]
                )
        session.add(
            RequestLog(
                api_key_id=rec.api_key_id,
                conversation_id=conversation_id if succeeded else rec.conversation_id,
                created_at=now,
                latency_ms=rec.latency_ms,
                prompt_tokens=rec.prompt_tokens,
                completion_tokens=rec.completion_tokens,
                cache_hit=rec.cache_state == "HIT",
                status=rec.status,
                provider=rec.provider,
                model=rec.model,
                error=rec.error,
            )
        )
        await _upsert_usage(session, rec, today=now.date())
    return conversation_id if succeeded else None


async def _upsert_usage(session: AsyncSession, rec: RequestRecord, *, today: date) -> None:
    values = {
        "day": today,
        "api_key_id": rec.api_key_id,
        "request_count": 1,
        "prompt_tokens": rec.prompt_tokens,
        "completion_tokens": rec.completion_tokens,
        "cache_hits": 1 if rec.cache_state == "HIT" else 0,
        "cache_misses": 1 if rec.cache_state == "MISS" else 0,
        "error_count": 1 if rec.status >= 400 else 0,
        "total_latency_ms": rec.latency_ms,
    }
    stmt = pg_insert(UsageDaily).values(id=uuid.uuid4(), **values)
    table = UsageDaily.__table__
    stmt = stmt.on_conflict_do_update(
        constraint="uq_usage_daily_day_key",
        set_={
            col: table.c[col] + stmt.excluded[col]
            for col in values
            if col not in ("day", "api_key_id")
        },
    )
    await session.execute(stmt)


@dataclass(frozen=True)
class UsageTotals:
    requests: int
    prompt_tokens: int
    completion_tokens: int
    cache_hit_rate: float
    p95_latency_ms: float | None
    errors: int


def _filters(
    api_key_id: uuid.UUID | None, start: datetime, end: datetime
) -> list[ColumnElement[bool]]:
    filters: list[ColumnElement[bool]] = [
        RequestLog.created_at >= start,
        RequestLog.created_at < end,
    ]
    if api_key_id is not None:
        filters.append(RequestLog.api_key_id == api_key_id)
    return filters


def day_bounds(start_day: date, end_day: date) -> tuple[datetime, datetime]:
    """Inclusive UTC date range -> [start, end) datetimes."""
    start = datetime.combine(start_day, datetime.min.time(), tzinfo=UTC)
    end = datetime.combine(end_day, datetime.min.time(), tzinfo=UTC) + timedelta(days=1)
    return start, end


async def summarize(
    factory: async_sessionmaker[AsyncSession],
    *,
    api_key_id: uuid.UUID | None,
    start: datetime,
    end: datetime,
) -> UsageTotals:
    stmt = select(
        func.count(RequestLog.id),
        func.coalesce(func.sum(RequestLog.prompt_tokens), 0),
        func.coalesce(func.sum(RequestLog.completion_tokens), 0),
        func.coalesce(func.avg(case((RequestLog.cache_hit.is_(True), 1.0), else_=0.0)), 0.0),
        func.percentile_cont(0.95).within_group(RequestLog.latency_ms),
        func.coalesce(func.sum(case((RequestLog.status >= 400, 1), else_=0)), 0),
    ).where(*_filters(api_key_id, start, end))
    async with factory() as session:
        row = (await session.execute(stmt)).one()
    count, prompt, completion, hit_rate, p95, errors = row
    return UsageTotals(
        requests=int(count),
        prompt_tokens=int(prompt),
        completion_tokens=int(completion),
        cache_hit_rate=float(hit_rate),
        p95_latency_ms=float(p95) if p95 is not None else None,
        errors=int(errors),
    )


async def recent_logs(
    factory: async_sessionmaker[AsyncSession],
    *,
    api_key_id: uuid.UUID | None,
    limit: int,
) -> list[RequestLog]:
    stmt = select(RequestLog).order_by(RequestLog.created_at.desc()).limit(limit)
    if api_key_id is not None:
        stmt = stmt.where(RequestLog.api_key_id == api_key_id)
    async with factory() as session:
        result = await session.execute(stmt)
        return list(result.scalars().all())
