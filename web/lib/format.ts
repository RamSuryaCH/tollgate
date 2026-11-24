/** Display helpers. Missing values render as an em dash, never as 0. */

export const EMPTY = "—";

export function formatInt(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatPercent(fraction: number | null | undefined): string {
  if (fraction == null || !Number.isFinite(fraction)) return EMPTY;
  return `${(fraction * 100).toFixed(1)}%`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return EMPTY;
  return `${Math.round(ms).toLocaleString("en-US")} ms`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Shortens a UUID or key for display. The full value stays available in a title attribute. */
export function shortId(value: string | null | undefined, length = 8): string {
  if (!value) return EMPTY;
  return value.slice(0, length);
}

export function maskKey(key: string): string {
  if (key.length <= 10) return "••••";
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}
