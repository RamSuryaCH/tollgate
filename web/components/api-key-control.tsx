"use client";

import { useState, type FormEvent } from "react";
import { maskKey } from "@/lib/format";
import { STORAGE_KEYS } from "@/lib/config";
import { useStoredValue } from "@/lib/storage";

/** Saves the user API key (Bearer token) in localStorage. Shown in the header on every page. */
export function ApiKeyControl() {
  const [savedKey, setSavedKey] = useStoredValue(STORAGE_KEYS.apiKey);
  const [draft, setDraft] = useState("");

  if (savedKey) {
    return (
      <div className="flex h-8 items-center gap-2 text-sm">
        <span className="text-muted">API key</span>
        <span
          className="rounded-md border border-rule bg-card px-2 py-1 font-mono text-[13px] leading-4 text-ink"
          title="Saved in this browser only"
        >
          {maskKey(savedKey)}
        </span>
        <button
          type="button"
          onClick={() => setSavedKey(null)}
          className="rounded-md px-1.5 py-1 text-sm text-muted underline decoration-rule underline-offset-4 hover:text-ink hover:decoration-muted"
        >
          Clear
        </button>
      </div>
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    setSavedKey(value);
    setDraft("");
  }

  return (
    <form onSubmit={onSubmit} className="flex h-8 items-center gap-2">
      <label htmlFor="api-key-input" className="sr-only">
        API key
      </label>
      <input
        id="api-key-input"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Paste API key (tg_…)"
        className="h-8 w-48 rounded-md border border-copper/60 bg-card px-2.5 font-mono text-[13px] text-ink placeholder:font-sans placeholder:text-sm placeholder:text-faint hover:border-copper focus:border-copper"
      />
      <button
        type="submit"
        disabled={!draft.trim()}
        className="h-8 rounded-md border border-copper bg-copper px-3 text-sm font-medium text-white transition-colors hover:border-copper-deep hover:bg-copper-deep disabled:cursor-not-allowed disabled:opacity-50"
      >
        Save
      </button>
    </form>
  );
}
