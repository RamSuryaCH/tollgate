"use client";

import { useState, type FormEvent } from "react";
import { Button, inputClass } from "@/components/ui";
import { maskKey } from "@/lib/format";
import { STORAGE_KEYS } from "@/lib/config";
import { useStoredValue } from "@/lib/storage";

/** Saves the user API key (Bearer token) in localStorage. Shown in the header on every page. */
export function ApiKeyControl() {
  const [savedKey, setSavedKey] = useStoredValue(STORAGE_KEYS.apiKey);
  const [draft, setDraft] = useState("");

  if (savedKey) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted">API key</span>
        <span className="font-mono text-xs text-ink" title="Saved in this browser only">
          {maskKey(savedKey)}
        </span>
        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setSavedKey(null)}>
          Clear
        </Button>
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
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <label htmlFor="api-key-input" className="text-sm text-muted">
        API key
      </label>
      <input
        id="api-key-input"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="tg_…"
        className={`${inputClass} w-48 py-1.5 font-mono text-xs`}
      />
      <Button type="submit" variant="primary" className="px-3 py-1.5 text-xs" disabled={!draft.trim()}>
        Save
      </Button>
    </form>
  );
}
