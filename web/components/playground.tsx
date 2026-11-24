"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  ApiError,
  errorMessage,
  postChat,
  readSseData,
  type ChatChunk,
  type ChatCompletion,
  type ChatMessage,
  type ChatRequest,
} from "@/lib/api";
import { DEFAULT_MODEL, STORAGE_KEYS } from "@/lib/config";
import { formatInt, shortId } from "@/lib/format";
import { useStoredValue } from "@/lib/storage";
import { Badge, Button, Card, inputClass, Notice, SectionTitle } from "@/components/ui";

interface ReplyMeta {
  /** Value of the X-Cache response header: HIT, MISS, or BYPASS. */
  cache: string | null;
  streamed: boolean;
  usage?: ChatCompletion["usage"];
}

interface Message {
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  meta?: ReplyMeta;
}

/** Text received for the in-flight reply, kept outside React state so the catch block can read it. */
interface Progress {
  text: string;
}

interface SendError {
  status: number | null;
  message: string;
  retryAfter: number | null;
}

const MAX_TOKENS_LIMIT = 32_768;

function parseSettings(temperature: string, maxTokens: string): { temperature: number; maxTokens: number | null } | string {
  const t = Number(temperature);
  if (temperature.trim() === "" || !Number.isFinite(t) || t < 0 || t > 2) {
    return "Temperature must be a number from 0 to 2.";
  }
  if (maxTokens.trim() === "") return { temperature: t, maxTokens: null };
  const m = Number(maxTokens);
  if (!Number.isInteger(m) || m < 1 || m > MAX_TOKENS_LIMIT) {
    return `Max tokens must be a whole number from 1 to ${formatInt(MAX_TOKENS_LIMIT)}.`;
  }
  return { temperature: t, maxTokens: m };
}

const cacheTone = { HIT: "hit", MISS: "miss" } as const;

export function Playground() {
  const [apiKey] = useStoredValue(STORAGE_KEYS.apiKey);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [temperature, setTemperature] = useState("0");
  const [maxTokens, setMaxTokens] = useState("");
  const [stream, setStream] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SendError | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);

  const resetChat = useCallback(() => {
    controllerRef.current?.abort();
    setMessages([]);
    setConversationId(null);
    setError(null);
  }, []);

  // A conversation belongs to the key that created it. Switching keys starts a new chat.
  const lastKey = useRef(apiKey);
  useEffect(() => {
    if (lastKey.current === apiKey) return;
    lastKey.current = apiKey;
    resetChat();
  }, [apiKey, resetChat]);

  useEffect(() => {
    const controller = controllerRef;
    return () => controller.current?.abort();
  }, []);

  // Scroll to the newest message when a turn starts, not on every streamed token.
  const turnCount = messages.length;
  useEffect(() => {
    if (turnCount > 0) transcriptEnd.current?.scrollIntoView({ block: "end" });
  }, [turnCount]);

  function updateLast(patch: (message: Message) => Message) {
    setMessages((prev) =>
      prev.map((message, index) => (index === prev.length - 1 ? patch(message) : message)),
    );
  }

  async function readStream(res: Response, cache: string | null, progress: Progress) {
    if (!res.body) throw new Error("The server sent an empty response.");
    for await (const data of readSseData(res.body)) {
      if (data === "[DONE]") break;
      const chunk = JSON.parse(data) as ChatChunk | { error: { message: string } };
      if ("error" in chunk) throw new ApiError(chunk.error.message, 502, null);
      if (chunk.conversation_id) setConversationId(chunk.conversation_id);
      const piece = chunk.choices[0]?.delta.content;
      if (piece) {
        progress.text += piece;
        updateLast((m) => ({ ...m, content: m.content + piece }));
      }
    }
    updateLast((m) => ({ ...m, pending: false, meta: { cache, streamed: true } }));
  }

  async function readOnce(res: Response, cache: string | null, progress: Progress) {
    const data = (await res.json()) as ChatCompletion;
    setConversationId(data.conversation_id);
    progress.text = data.choices[0]?.message.content ?? "";
    updateLast((m) => ({
      ...m,
      content: progress.text,
      pending: false,
      meta: { cache, streamed: false, usage: data.usage },
    }));
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy || !apiKey) return;

    const settings = parseSettings(temperature, maxTokens);
    if (typeof settings === "string") {
      setError({ status: null, message: settings, retryAfter: null });
      return;
    }

    // Build the request from the transcript so far, then add this turn.
    const turns: Message[] = [...messages, { role: "user", content: text }];
    const history: ChatMessage[] = turns.map((m) => ({ role: m.role, content: m.content }));
    const body: ChatRequest = {
      messages: history,
      temperature: settings.temperature,
      stream,
      ...(model.trim() ? { model: model.trim() } : {}),
      ...(settings.maxTokens !== null ? { max_tokens: settings.maxTokens } : {}),
      ...(conversationId ? { conversation_id: conversationId } : {}),
    };

    const controller = new AbortController();
    const progress: Progress = { text: "" };
    controllerRef.current = controller;
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: "", pending: true },
    ]);
    setDraft("");
    setError(null);
    setBusy(true);

    try {
      const res = await postChat(body, apiKey, controller.signal);
      const cache = res.headers.get("X-Cache");
      if (stream) {
        await readStream(res, cache, progress);
      } else {
        await readOnce(res, cache, progress);
      }
    } catch (err) {
      if (controller.signal.aborted && progress.text) {
        // Stop pressed after some tokens arrived: keep the partial reply.
        updateLast((m) => ({ ...m, pending: false }));
      } else {
        // Failed or stopped before any reply: return the turn to the composer so it can be resent.
        setMessages((prev) => prev.slice(0, -2));
        setDraft((current) => current || text);
        if (!controller.signal.aborted) {
          setError({
            status: err instanceof ApiError ? err.status : null,
            message: errorMessage(err),
            retryAfter: err instanceof ApiError ? err.retryAfter : null,
          });
        }
      }
    } finally {
      controllerRef.current = null;
      setBusy(false);
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  const canSend = Boolean(apiKey) && draft.trim() !== "" && !busy;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="flex min-w-0 flex-col rounded-md border border-rule bg-card">
        <div className="max-h-[62vh] min-h-[360px] space-y-6 overflow-y-auto p-5" aria-live="polite">
          {!apiKey && (
            <Notice>
              No API key is saved. Paste one in the top bar to send messages. Keys are created on the
              Keys page, and the server shows each plaintext key only once.
            </Notice>
          )}
          {apiKey && messages.length === 0 && (
            <p className="text-sm text-muted">
              Send a message to start a conversation. The reply comes from the model configured on
              the server.
            </p>
          )}
          {messages.map((message, index) => (
            <article key={index} className="space-y-1.5">
              <h3 className="font-mono text-xs tracking-wide text-muted uppercase">
                {message.role === "user" ? "You" : "Assistant"}
              </h3>
              <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-ink">
                {message.content}
                {message.pending && message.content === "" && (
                  <span className="text-muted">Waiting for the first token…</span>
                )}
              </p>
              {message.meta && <ReplyMetaRow meta={message.meta} />}
            </article>
          ))}
          <div ref={transcriptEnd} />
        </div>

        {error && (
          <div className="border-t border-rule p-4">
            <Notice tone="error" role="alert">
              <p className="font-medium">
                {error.status === 429 ? "Rate limited" : "Request failed"}
              </p>
              <p className="mt-1">{error.message}</p>
              {error.retryAfter !== null && (
                <p className="mt-1 font-mono text-xs">Retry-After: {error.retryAfter} s</p>
              )}
            </Notice>
          </div>
        )}

        <form
          className="flex items-end gap-3 border-t border-rule p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="sr-only" htmlFor="composer">
            Message
          </label>
          <textarea
            id="composer"
            rows={3}
            value={draft}
            disabled={!apiKey}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder={apiKey ? "Write a message. Enter sends, Shift+Enter adds a line." : "Save an API key to start."}
            className={`${inputClass} min-h-[5rem] resize-y leading-relaxed`}
          />
          {busy ? (
            <Button variant="secondary" onClick={() => controllerRef.current?.abort()}>
              Stop
            </Button>
          ) : (
            <Button type="submit" variant="primary" disabled={!canSend}>
              Send
            </Button>
          )}
        </form>
      </div>

      <aside className="space-y-5">
        <Card className="space-y-4">
          <SectionTitle>Settings</SectionTitle>
          <Field label="Model" htmlFor="model">
            <input
              id="model"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={`${inputClass} font-mono text-xs`}
              placeholder="Server default"
            />
          </Field>
          <Field label="Temperature" htmlFor="temperature">
            <input
              id="temperature"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              className={`${inputClass} font-mono text-xs`}
            />
          </Field>
          <Field label="Max tokens" htmlFor="max-tokens">
            <input
              id="max-tokens"
              type="number"
              min={1}
              max={MAX_TOKENS_LIMIT}
              step={1}
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              className={`${inputClass} font-mono text-xs`}
              placeholder="Model default"
            />
          </Field>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Stream tokens</span>
            <input
              type="checkbox"
              checked={stream}
              onChange={(e) => setStream(e.target.checked)}
              className="size-4 accent-copper"
            />
          </label>
          <p className="text-xs leading-relaxed text-muted">
            Caching applies only when temperature is 0, streaming is off, and the key allows
            caching. Other requests show X-Cache: BYPASS.
          </p>
        </Card>

        <Card className="space-y-3">
          <SectionTitle>Conversation</SectionTitle>
          <p className="font-mono text-xs text-muted" title={conversationId ?? undefined}>
            {conversationId ? `id ${shortId(conversationId, 8)}` : "Not started"}
          </p>
          <Button variant="secondary" className="w-full" onClick={resetChat} disabled={busy}>
            New chat
          </Button>
          <p className="text-xs leading-relaxed text-muted">
            The server keeps each turn for usage history. The transcript shown here lives only in
            this tab and clears on reload.
          </p>
        </Card>
      </aside>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm text-ink">
        {label}
      </label>
      {children}
    </div>
  );
}

function ReplyMetaRow({ meta }: { meta: ReplyMeta }) {
  const tone = meta.cache && meta.cache in cacheTone ? cacheTone[meta.cache as keyof typeof cacheTone] : "neutral";
  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted">
      <Badge tone={tone}>X-Cache: {meta.cache ?? "n/a"}</Badge>
      {meta.usage ? (
        <span>
          prompt {formatInt(meta.usage.prompt_tokens)} · completion{" "}
          {formatInt(meta.usage.completion_tokens)} · total {formatInt(meta.usage.total_tokens)} tokens
        </span>
      ) : (
        meta.streamed && <span>streamed, token counts not reported</span>
      )}
    </div>
  );
}
