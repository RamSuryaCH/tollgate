import { API_URL } from "./config";

// Types mirror src/tollgate/schemas.py and the chat response shapes in api/chat.py.

export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ChatRequest {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  conversation_id?: string;
}

export interface ChatCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: { index: number; message: ChatMessage; finish_reason: string }[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  conversation_id: string;
}

export interface ChatChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  conversation_id: string;
  choices: { index: number; delta: { role?: Role; content?: string }; finish_reason: string | null }[];
}

export interface UsageSummary {
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cache_hit_rate: number;
  p95_latency_ms: number | null;
  errors: number;
}

export interface UsageRow {
  id: string;
  created_at: string;
  model: string;
  provider: string;
  status: number;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  cache_hit: boolean;
  conversation_id: string | null;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  rate_limit_rpm: number;
  cache_enabled: boolean;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface CreatedApiKey {
  id: string;
  name: string;
  prefix: string;
  /** Full plaintext key. The server returns it once, on creation only. */
  key: string;
  rate_limit_rpm: number;
  cache_enabled: boolean;
  created_at: string;
}

export interface CreateKeyInput {
  name: string;
  rate_limit_rpm?: number;
  cache_enabled: boolean;
}

export interface Health {
  status: string;
  postgres: string;
  redis: string;
}

/** An HTTP error from the API. `retryAfter` is set from the Retry-After header, in seconds. */
export class ApiError extends Error {
  readonly status: number;
  readonly retryAfter: number | null;

  constructor(message: string, status: number, retryAfter: number | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

export function bearer(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}` };
}

export function adminHeader(key: string): Record<string, string> {
  return { "X-Admin-Key": key };
}

async function toApiError(res: Response): Promise<ApiError> {
  let detail = res.statusText || `HTTP ${res.status}`;
  try {
    const data = (await res.json()) as { detail?: unknown };
    if (typeof data.detail === "string") {
      detail = data.detail;
    } else if (Array.isArray(data.detail)) {
      // FastAPI validation errors put a list of {loc, msg, ...} objects in detail.
      detail = data.detail
        .map((item: { msg?: unknown }) => (typeof item.msg === "string" ? item.msg : "invalid value"))
        .join("; ");
    }
  } catch {
    // Body is not JSON. Keep the status text.
  }
  const retry = Number.parseInt(res.headers.get("Retry-After") ?? "", 10);
  return new ApiError(detail, res.status, Number.isFinite(retry) ? retry : null);
}

/** Human-readable message for any thrown value, including network failures. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) {
    return `Cannot reach the API at ${API_URL}. Check that it is running and that CORS allows this page.`;
  }
  if (err instanceof Error) return err.message;
  return "Unexpected error";
}

async function getJson<T>(path: string, headers: Record<string, string>, signal?: AbortSignal) {
  const res = await fetch(apiUrl(path), { headers, signal, cache: "no-store" });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export function fetchHealth(signal?: AbortSignal): Promise<Health> {
  return fetch(apiUrl("/healthz"), { signal, cache: "no-store" }).then(async (res) => {
    // /healthz answers 503 with the same JSON body when a dependency is down. Read it either way.
    const body = (await res.json().catch(() => null)) as Health | null;
    if (!body) throw new ApiError(`HTTP ${res.status}`, res.status, null);
    return body;
  });
}

export function postChat(body: ChatRequest, apiKey: string, signal?: AbortSignal): Promise<Response> {
  return fetch(apiUrl("/v1/chat"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: body.stream ? "text/event-stream" : "application/json",
      ...bearer(apiKey),
    },
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
  }).then(async (res) => {
    if (!res.ok) throw await toApiError(res);
    return res;
  });
}

export function fetchUsageSummary(
  apiKey: string,
  range: { from?: string; to?: string },
  signal?: AbortSignal,
): Promise<UsageSummary> {
  const params = new URLSearchParams();
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  const query = params.toString();
  return getJson<UsageSummary>(
    `/v1/usage/summary${query ? `?${query}` : ""}`,
    bearer(apiKey),
    signal,
  );
}

export function fetchRecentUsage(
  apiKey: string,
  limit = 50,
  signal?: AbortSignal,
): Promise<UsageRow[]> {
  return getJson<UsageRow[]>(`/v1/usage/recent?limit=${limit}`, bearer(apiKey), signal);
}

export function fetchKeys(
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<ApiKeyRecord[]> {
  return getJson<ApiKeyRecord[]>("/v1/keys", headers, signal);
}

export async function createKey(adminKey: string, input: CreateKeyInput): Promise<CreatedApiKey> {
  const res = await fetch(apiUrl("/v1/admin/keys"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeader(adminKey) },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as CreatedApiKey;
}

export async function revokeKey(adminKey: string, id: string): Promise<ApiKeyRecord> {
  const res = await fetch(apiUrl(`/v1/keys/${encodeURIComponent(id)}/revoke`), {
    method: "POST",
    headers: adminHeader(adminKey),
    cache: "no-store",
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as ApiKeyRecord;
}

/**
 * Yields the `data:` payload of each server-sent event. Events end with a blank line.
 * Multi-line data fields are joined with newlines, per the SSE spec.
 */
export async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const parseEvent = (raw: string): string | null => {
    const data = raw
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    return data === "" ? null : data;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const data = parseEvent(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (data !== null) yield data;
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    const tail = parseEvent(buffer);
    if (tail !== null) yield tail;
  } finally {
    reader.releaseLock();
  }
}
