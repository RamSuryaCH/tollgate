"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  errorMessage,
  fetchRecentUsage,
  fetchUsageSummary,
  type UsageRow,
  type UsageSummary,
} from "@/lib/api";
import { EMPTY, formatDateTime, formatInt, formatMs, formatPercent, shortId } from "@/lib/format";
import { STORAGE_KEYS } from "@/lib/config";
import { useStoredValue } from "@/lib/storage";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FieldLabel,
  inputClass,
  Notice,
  SectionTitle,
  Skeleton,
} from "@/components/ui";

interface DateRange {
  from?: string;
  to?: string;
}

export function UsageDashboard() {
  const [apiKey] = useStoredValue(STORAGE_KEYS.apiKey);
  const [fromDraft, setFromDraft] = useState("");
  const [toDraft, setToDraft] = useState("");
  const [range, setRange] = useState<DateRange>({});
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!apiKey) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      fetchUsageSummary(apiKey, range, controller.signal),
      fetchRecentUsage(apiKey, 50, controller.signal),
    ])
      .then(([nextSummary, nextRows]) => {
        setSummary(nextSummary);
        setRows(nextRows);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [apiKey, range, refreshToken]);

  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (fromDraft && toDraft && fromDraft > toDraft) {
      setError("The start date must be on or before the end date.");
      return;
    }
    setRange({ from: fromDraft || undefined, to: toDraft || undefined });
  }

  function resetRange() {
    setFromDraft("");
    setToDraft("");
    setRange({});
  }

  if (!apiKey) {
    return (
      <Card>
        <EmptyState title="No API key saved">
          Paste a key into the top bar to see its usage. An admin key shows usage across all keys.
        </EmptyState>
      </Card>
    );
  }

  const hasRequests = (summary?.requests ?? 0) > 0;
  const pending = loading && !summary;

  return (
    <div className="space-y-8">
      <form onSubmit={applyRange} className="flex flex-wrap items-end gap-x-3 gap-y-3">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="from">From</FieldLabel>
          <input
            id="from"
            type="date"
            value={fromDraft}
            onChange={(e) => setFromDraft(e.target.value)}
            className={`${inputClass} w-44 font-mono text-[13px]`}
          />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="to">To</FieldLabel>
          <input
            id="to"
            type="date"
            value={toDraft}
            onChange={(e) => setToDraft(e.target.value)}
            className={`${inputClass} w-44 font-mono text-[13px]`}
          />
        </div>
        <Button type="submit" variant="primary">
          Apply
        </Button>
        <Button onClick={resetRange}>Last 7 days</Button>
        <Button
          variant="ghost"
          className="ml-auto"
          onClick={() => setRefreshToken((n) => n + 1)}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </form>

      {error && (
        <Notice tone="error" role="alert">
          {error}
        </Notice>
      )}

      <section aria-labelledby="summary-heading" className="space-y-3">
        <SectionTitle>
          <span id="summary-heading">
            Summary · {range.from || range.to ? `${range.from ?? "start"} to ${range.to ?? "today"}` : "last 7 days"}
          </span>
        </SectionTitle>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="Requests"
            value={summary ? formatInt(summary.requests) : EMPTY}
            detail="in this range"
            pending={pending}
          />
          <Stat
            label="Total tokens"
            value={summary ? formatInt(summary.total_tokens) : EMPTY}
            detail={
              summary
                ? `${formatInt(summary.prompt_tokens)} in · ${formatInt(summary.completion_tokens)} out`
                : "prompt and completion"
            }
            pending={pending}
          />
          <Stat
            label="Cache hit rate"
            value={summary && hasRequests ? formatPercent(summary.cache_hit_rate) : EMPTY}
            detail="of requests"
            pending={pending}
          />
          <Stat
            label="p95 latency"
            value={summary ? formatMs(summary.p95_latency_ms) : EMPTY}
            detail="95th percentile"
            pending={pending}
          />
          <Stat
            label="Errors"
            value={summary ? formatInt(summary.errors) : EMPTY}
            detail="status 400 or higher"
            pending={pending}
          />
        </div>
      </section>

      <section aria-labelledby="recent-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <SectionTitle>
            <span id="recent-heading">Recent requests</span>
          </SectionTitle>
          <p className="text-sm text-muted">
            Latest 50, regardless of the date range. Cache hits count 0 tokens.
          </p>
        </div>
        <Card padding="p-0" className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-rule bg-paper/60 font-mono text-xs tracking-wider text-muted uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Latency</th>
                <th className="px-4 py-3 text-right font-medium">Tokens</th>
                <th className="px-4 py-3 font-medium">Cache</th>
                <th className="px-4 py-3 font-medium">Conversation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {rows.length === 0 && loading && <SkeletonRows />}
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={8}>
                    <EmptyState title="No requests yet">
                      Send a message in the{" "}
                      <Link href="/" className="text-ink underline decoration-copper underline-offset-4">
                        Playground
                      </Link>{" "}
                      and it will show up here.
                    </EmptyState>
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className="align-top transition-colors hover:bg-paper/50">
                  <td className="px-4 py-3 whitespace-nowrap text-muted">{formatDateTime(row.created_at)}</td>
                  <td className="max-w-56 px-4 py-3 font-mono text-[13px] break-all">{row.model}</td>
                  <td className="px-4 py-3 font-mono text-[13px] break-words">{row.provider}</td>
                  <td className="px-4 py-3">
                    <Badge tone={row.status >= 400 ? "error" : "ok"}>{row.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[13px] whitespace-nowrap">
                    {formatMs(row.latency_ms)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[13px]">
                    {formatInt(row.prompt_tokens + row.completion_tokens)}
                  </td>
                  <td className="px-4 py-3">
                    {row.status >= 400 ? (
                      <span className="text-muted" title="Failed requests have no cache outcome">
                        {EMPTY}
                      </span>
                    ) : (
                      <Badge tone={row.cache_hit ? "hit" : "miss"}>{row.cache_hit ? "HIT" : "MISS"}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-[13px]" title={row.conversation_id ?? undefined}>
                    {shortId(row.conversation_id)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}

/** Four pulsing rows with the same cell padding as real rows, shown while the first load runs. */
function SkeletonRows() {
  return (
    <>
      {[0, 1, 2, 3].map((n) => (
        <tr key={n} aria-hidden="true">
          <td colSpan={8} className="px-4 py-3.5">
            <Skeleton className="h-4 w-full" />
          </td>
        </tr>
      ))}
    </>
  );
}

function Stat({
  label,
  value,
  detail,
  pending,
}: {
  label: string;
  value: string;
  detail: string;
  pending: boolean;
}) {
  return (
    <Card padding="p-4">
      <p className="font-mono text-xs tracking-wider text-muted uppercase">{label}</p>
      <div className="mt-2 flex h-8 items-center">
        {pending ? (
          <Skeleton className="h-6 w-20" />
        ) : (
          <p className="font-mono text-2xl leading-8 font-medium tracking-tight text-ink tabular-nums">
            {value}
          </p>
        )}
      </div>
      <p className="mt-1 font-mono text-[13px] text-muted tabular-nums">{detail}</p>
    </Card>
  );
}
