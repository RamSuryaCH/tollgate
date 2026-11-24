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
import { Badge, Button, Card, inputClass, Notice, SectionTitle } from "@/components/ui";

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
      <Notice>
        No API key is saved. Paste one in the top bar to see usage for that key. An admin key shows
        usage across all keys.
      </Notice>
    );
  }

  const hasRequests = (summary?.requests ?? 0) > 0;

  return (
    <div className="space-y-8">
      <form onSubmit={applyRange} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label htmlFor="from" className="block text-sm">
            From
          </label>
          <input
            id="from"
            type="date"
            value={fromDraft}
            onChange={(e) => setFromDraft(e.target.value)}
            className={`${inputClass} w-44 font-mono text-xs`}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="to" className="block text-sm">
            To
          </label>
          <input
            id="to"
            type="date"
            value={toDraft}
            onChange={(e) => setToDraft(e.target.value)}
            className={`${inputClass} w-44 font-mono text-xs`}
          />
        </div>
        <Button type="submit" variant="primary">
          Apply
        </Button>
        <Button variant="secondary" onClick={resetRange}>
          Last 7 days
        </Button>
        <Button variant="ghost" onClick={() => setRefreshToken((n) => n + 1)} disabled={loading}>
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
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Stat label="Requests" value={summary ? formatInt(summary.requests) : EMPTY} />
          <Stat
            label="Total tokens"
            value={summary ? formatInt(summary.total_tokens) : EMPTY}
            detail={
              summary
                ? `${formatInt(summary.prompt_tokens)} in · ${formatInt(summary.completion_tokens)} out`
                : undefined
            }
          />
          <Stat
            label="Cache hit rate"
            value={summary && hasRequests ? formatPercent(summary.cache_hit_rate) : EMPTY}
          />
          <Stat label="p95 latency" value={summary ? formatMs(summary.p95_latency_ms) : EMPTY} />
          <Stat
            label="Errors"
            value={summary ? formatInt(summary.errors) : EMPTY}
            detail="status 400 or higher"
          />
        </div>
      </section>

      <section aria-labelledby="recent-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <SectionTitle>
            <span id="recent-heading">Recent requests</span>
          </SectionTitle>
          <p className="text-xs text-muted">
            Latest 50, regardless of the date range. Cache hits count 0 tokens.
          </p>
        </div>
        <Card padding="p-0" className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-rule font-mono text-xs tracking-wide text-muted uppercase">
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
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-muted">
                    {loading ? "Loading…" : "No requests yet for this key."}
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className="align-middle">
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted">
                    {formatDateTime(row.created_at)}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{row.model}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{row.provider}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={row.status >= 400 ? "error" : "neutral"}>{row.status}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{formatMs(row.latency_ms)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">
                    {formatInt(row.prompt_tokens + row.completion_tokens)}
                  </td>
                  <td className="px-4 py-2.5">
                    {row.cache_hit ? (
                      <Badge tone="hit">HIT</Badge>
                    ) : (
                      <span className="text-xs text-muted">not a hit</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs" title={row.conversation_id ?? undefined}>
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

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card padding="p-4">
      <p className="font-mono text-xs tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-2 font-mono text-2xl font-medium text-ink">{value}</p>
      {detail && <p className="mt-1 text-xs text-muted">{detail}</p>}
    </Card>
  );
}
