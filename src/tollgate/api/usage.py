"""GET /v1/usage/summary and /v1/usage/recent. Scoped to the caller's key, or all keys for admin."""

from datetime import UTC, date, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request

from tollgate.api.deps import Principal, PrincipalDep
from tollgate.db import get_session_factory
from tollgate.schemas import UsageRow, UsageSummary
from tollgate.usage import day_bounds, recent_logs, summarize

router = APIRouter(prefix="/v1/usage", tags=["usage"])

DEFAULT_WINDOW_DAYS = 7
MAX_RECENT = 200


def _scope(principal: Principal, requested: UUID | None) -> UUID | None:
    """Return the api_key_id to filter on. None means all keys (admin only)."""
    if principal.is_admin:
        return requested
    if principal.api_key is None:
        raise HTTPException(status_code=403, detail="Not allowed")
    if requested is not None and requested != principal.api_key.id:
        raise HTTPException(status_code=403, detail="Not allowed")
    return principal.api_key.id


@router.get("/summary", response_model=UsageSummary)
async def usage_summary(
    request: Request,
    principal: PrincipalDep,
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
    api_key_id: UUID | None = None,
) -> UsageSummary:
    end_day = to or datetime.now(UTC).date()
    start_day = from_ or end_day - timedelta(days=DEFAULT_WINDOW_DAYS - 1)
    if start_day > end_day:
        raise HTTPException(status_code=422, detail="'from' must not be after 'to'")
    start, end = day_bounds(start_day, end_day)
    totals = await summarize(
        get_session_factory(request),
        api_key_id=_scope(principal, api_key_id),
        start=start,
        end=end,
    )
    return UsageSummary(
        requests=totals.requests,
        prompt_tokens=totals.prompt_tokens,
        completion_tokens=totals.completion_tokens,
        total_tokens=totals.prompt_tokens + totals.completion_tokens,
        cache_hit_rate=totals.cache_hit_rate,
        p95_latency_ms=totals.p95_latency_ms,
        errors=totals.errors,
    )


@router.get("/recent", response_model=list[UsageRow])
async def usage_recent(
    request: Request,
    principal: PrincipalDep,
    limit: int = Query(default=50, ge=1, le=MAX_RECENT),
    api_key_id: UUID | None = None,
) -> list[UsageRow]:
    rows = await recent_logs(
        get_session_factory(request),
        api_key_id=_scope(principal, api_key_id),
        limit=limit,
    )
    return [
        UsageRow(
            id=r.id,
            created_at=r.created_at,
            model=r.model,
            provider=r.provider,
            status=r.status,
            latency_ms=r.latency_ms,
            prompt_tokens=r.prompt_tokens,
            completion_tokens=r.completion_tokens,
            cache_hit=r.cache_hit,
            conversation_id=r.conversation_id,
        )
        for r in rows
    ]
