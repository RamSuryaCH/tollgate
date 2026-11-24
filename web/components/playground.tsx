"use client";

import Link from "next/link";
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
import { Badge, Button, inputClass, Notice } from "@/components/ui";

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
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);

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

  // Follow the newest text while the reader is at the bottom. Scrolling up pauses following until
  // they return to the bottom or start a new turn. The transcript has a fixed height, so the page
  // itself never moves while a reply streams.
  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, error]);

  function onTranscriptScroll() {
    const el = scroller.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }

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
    stickToBottom.current = true;
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

  function fillPrompt(text: string) {
    setDraft(text);
    composer.current?.focus();
  }

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-md border border-rule bg-card">
      <div
        ref={scroller}
        onScroll={onTranscriptScroll}
        role="log"
        aria-label="Conversation"
        className="flex h-[min(58vh,560px)] min-h-[360px] flex-col gap-5 overflow-y-auto bg-paper/50 px-6 py-6"
      >
        {messages.length === 0 && (
          <div className="m-auto max-w-lg py-4 text-center">
            {apiKey ? (
              <>
                <p className="font-mono text-base font-medium">Start a conversation</p>
                <p className="mt-1.5 text-[15px] text-muted">
                  Replies come from the model configured on the server. Try one of these, or write
                  your own below.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {EXAMPLE_PROMPTS.map((text) => (
                    <Button key={text} className="font-normal" onClick={() => fillPrompt(text)}>
                      {text}
                    </Button>
                  ))}
                </div>
                <p className="mt-5 text-sm text-muted">
                  To see a cache hit, set temperature 0, turn streaming off, and send the same
                  message twice. The transcript lives in this tab and clears on reload.
                </p>
              </>
            ) : (
              <>
                <p className="font-mono text-base font-medium">Add an API key to begin</p>
                <p className="mt-1.5 text-[15px] text-muted">
                  Paste a key into the top bar. Keys are created on the{" "}
                  <Link href="/keys" className="text-ink underline decoration-copper underline-offset-4">
                    Keys page
                  </Link>
                  , and the server shows each plaintext key only once.
                </p>
              </>
            )}
          </div>
        )}

        {messages.map((message, index) => (
          <MessageItem key={index} message={message} />
        ))}

        {error && (
          <div className="tg-fade-in">
            <Notice tone="error" role="alert">
              <p className="font-medium">{error.status === 429 ? "Rate limited" : "Request failed"}</p>
              <p className="mt-1">{error.message}</p>
              {error.retryAfter !== null && (
                <p className="mt-1.5 font-mono text-[13px]">Retry-After: {error.retryAfter} s</p>
              )}
            </Notice>
          </div>
        )}
      </div>

      <form
        className="border-t border-rule bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="flex items-end gap-3">
          <label className="sr-only" htmlFor="composer">
            Message
          </label>
          <textarea
            id="composer"
            ref={composer}
            rows={2}
            value={draft}
            disabled={!apiKey}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder={
              apiKey ? "Write a message. Enter sends, Shift+Enter adds a line." : "Save an API key to start."
            }
            className={`${inputClass} min-h-[4.5rem] resize-none py-2.5 text-[15px] leading-relaxed`}
          />
          {busy ? (
            <Button className="h-10 w-24" onClick={() => controllerRef.current?.abort()}>
              Stop
            </Button>
          ) : (
            <Button type="submit" variant="primary" className="h-10 w-24" disabled={!canSend}>
              Send
            </Button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <InlineField label="Model" htmlFor="model">
            <input
              id="model"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={`${compactInput} w-48`}
              placeholder="Server default"
            />
          </InlineField>
          <InlineField label="Temperature" htmlFor="temperature">
            <input
              id="temperature"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              className={`${compactInput} w-20`}
            />
          </InlineField>
          <InlineField label="Max tokens" htmlFor="max-tokens">
            <input
              id="max-tokens"
              type="number"
              min={1}
              max={MAX_TOKENS_LIMIT}
              step={1}
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              className={`${compactInput} w-28`}
              placeholder="Default"
            />
          </InlineField>
          <label
            className="flex h-8 items-center gap-2 text-sm"
            title="Caching applies only when temperature is 0, streaming is off, and the key allows caching. Other requests show X-Cache: BYPASS."
          >
            <input
              type="checkbox"
              checked={stream}
              onChange={(e) => setStream(e.target.checked)}
              className="size-4 accent-copper"
            />
            <span>Stream</span>
          </label>

          <div className="ml-auto flex items-center gap-3">
            <span className="font-mono text-[13px] text-muted" title={conversationId ?? undefined}>
              {conversationId ? `chat ${shortId(conversationId, 8)}` : "no chat yet"}
            </span>
            <Button className="h-8 px-3" onClick={resetChat} disabled={busy}>
              New chat
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

const compactInput = `${inputClass} h-8 py-1 font-mono text-[13px]`;

const EXAMPLE_PROMPTS = [
  "Explain what a rate limiter does in two sentences.",
  "Write a haiku about toll booths.",
  "List three uses for a response cache.",
];

function InlineField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={htmlFor} className="text-sm text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

function MessageItem({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const waiting = message.pending && message.content === "";
  return (
    <article className={`tg-fade-in flex flex-col gap-1.5 ${isUser ? "items-end" : "items-start"}`}>
      <h3 className="font-mono text-xs tracking-wider text-muted uppercase">
        {isUser ? "You" : "Assistant"}
      </h3>
      <div
        className={`max-w-[46rem] rounded-lg px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] ${
          isUser
            ? "rounded-tr-sm bg-ink text-paper"
            : "rounded-tl-sm border border-rule bg-card text-ink shadow-[0_1px_0_rgba(28,25,23,0.04)]"
        }`}
      >
        {waiting && <span className="text-muted">Waiting for the first token</span>}
        {message.content}
        {message.pending && <span aria-hidden="true" className="tg-caret" />}
      </div>
      {/* Always rendered for replies, so the row finishing does not push the transcript. */}
      {!isUser && <div className="min-h-6">{message.meta && <ReplyMetaRow meta={message.meta} />}</div>}
    </article>
  );
}

function ReplyMetaRow({ meta }: { meta: ReplyMeta }) {
  const tone = meta.cache && meta.cache in cacheTone ? cacheTone[meta.cache as keyof typeof cacheTone] : "neutral";
  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[13px] text-muted">
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
