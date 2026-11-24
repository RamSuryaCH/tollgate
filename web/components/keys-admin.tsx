"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  adminHeader,
  bearer,
  createKey,
  errorMessage,
  fetchKeys,
  revokeKey,
  type ApiKeyRecord,
  type CreatedApiKey,
} from "@/lib/api";
import { EMPTY, formatDateTime } from "@/lib/format";
import { STORAGE_KEYS } from "@/lib/config";
import { useStoredValue } from "@/lib/storage";
import { Badge, Button, Card, EmptyState, FieldLabel, inputClass, Notice, SectionTitle, Skeleton } from "@/components/ui";

const DEFAULT_RPM = 60;
const MAX_RPM = 100_000;

export function KeysAdmin() {
  const [apiKey] = useStoredValue(STORAGE_KEYS.apiKey);
  const [adminKey, setAdminKey] = useStoredValue(STORAGE_KEYS.adminKey);
  const [adminDraft, setAdminDraft] = useState<string | null>(null);

  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const [name, setName] = useState("");
  const [rpm, setRpm] = useState(String(DEFAULT_RPM));
  const [cacheEnabled, setCacheEnabled] = useState(true);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Listing works with the admin key (all keys) or, failing that, the user key (its own key only).
  useEffect(() => {
    const headers = adminKey ? adminHeader(adminKey) : apiKey ? bearer(apiKey) : null;
    if (!headers) {
      setKeys([]);
      return;
    }
    const controller = new AbortController();
    setListLoading(true);
    setListError(null);
    fetchKeys(headers, controller.signal)
      .then(setKeys)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setListError(errorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setListLoading(false);
      });
    return () => controller.abort();
  }, [adminKey, apiKey, refreshToken]);

  function saveAdminKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = (adminDraft ?? adminKey ?? "").trim();
    setAdminKey(value || null);
    setAdminDraft(null);
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const trimmedName = name.trim();
    if (!adminKey) {
      setFormError("Save the admin key first.");
      return;
    }
    if (!trimmedName) {
      setFormError("Name is required.");
      return;
    }
    if (trimmedName.length > 100) {
      setFormError("Name must be 100 characters or fewer.");
      return;
    }

    const rpmValue = rpm.trim() === "" ? undefined : Number(rpm);
    if (
      rpmValue !== undefined &&
      (!Number.isInteger(rpmValue) || rpmValue < 1 || rpmValue > MAX_RPM)
    ) {
      setFormError(
        `Requests per minute must be a whole number from 1 to ${MAX_RPM.toLocaleString("en-US")}.`,
      );
      return;
    }

    setCreating(true);
    try {
      const key = await createKey(adminKey, {
        name: trimmedName,
        rate_limit_rpm: rpmValue,
        cache_enabled: cacheEnabled,
      });
      setCreated(key);
      setCopied(false);
      setCopyError(null);
      setName("");
      setRefreshToken((n) => n + 1);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function copyCreatedKey() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
      setCopyError(null);
    } catch {
      setCopyError("Copy failed. Select the key text and copy it manually.");
    }
  }

  function dismissCreated() {
    setCreated(null);
    setCopied(false);
    setCopyError(null);
  }

  async function onRevoke(key: ApiKeyRecord) {
    if (!adminKey) return;
    if (!window.confirm(`Revoke "${key.name}"? Requests with this key will fail right away.`)) return;
    setRevokingId(key.id);
    setActionError(null);
    try {
      const updated = await revokeKey(adminKey, key.id);
      setKeys((prev) => prev.map((k) => (k.id === updated.id ? updated : k)));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setRevokingId(null);
    }
  }

  const shownAdminKey = adminDraft ?? adminKey ?? "";

  return (
    <div className="space-y-8">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="space-y-4">
          <div className="space-y-1">
            <SectionTitle>Admin key</SectionTitle>
            <p className="text-sm text-muted">
              Sent as X-Admin-Key to create and revoke keys. Stored in this browser only.
            </p>
          </div>
          <form onSubmit={saveAdminKey} className="space-y-3">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="admin-key">Admin key</FieldLabel>
              <input
                id="admin-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={shownAdminKey}
                onChange={(e) => setAdminDraft(e.target.value)}
                className={`${inputClass} font-mono text-[13px]`}
              />
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit">Save</Button>
              {adminKey && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAdminKey(null);
                    setAdminDraft(null);
                  }}
                >
                  Forget
                </Button>
              )}
              <span className="ml-auto">
                <Badge tone={adminKey ? "ok" : "neutral"}>{adminKey ? "saved" : "not saved"}</Badge>
              </span>
            </div>
          </form>
          <p className="text-sm text-muted">
            Without it, the list below uses the API key and shows only that key.
          </p>
        </Card>

        <Card className="space-y-4">
          <div className="space-y-1">
            <SectionTitle>Create key</SectionTitle>
            <p className="text-sm text-muted">The full key is shown once, right after it is created.</p>
          </div>
          <form onSubmit={onCreate} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="key-name">Name</FieldLabel>
              <input
                id="key-name"
                type="text"
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. laptop-playground"
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="key-rpm">Requests per minute</FieldLabel>
              <input
                id="key-rpm"
                type="number"
                min={1}
                max={MAX_RPM}
                step={1}
                value={rpm}
                onChange={(e) => setRpm(e.target.value)}
                className={`${inputClass} font-mono text-[13px]`}
              />
            </div>
            <label className="flex items-center gap-2.5 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={cacheEnabled}
                onChange={(e) => setCacheEnabled(e.target.checked)}
                className="size-4 accent-copper"
              />
              <span>Cache enabled</span>
              <span className="text-muted">Applies to non-streamed, temperature 0 requests.</span>
            </label>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <Button type="submit" variant="primary" disabled={creating || !adminKey}>
                {creating ? "Creating…" : "Create key"}
              </Button>
              {!adminKey && <span className="text-sm text-muted">Save the admin key first.</span>}
            </div>
          </form>
          {formError && (
            <Notice tone="error" role="alert">
              {formError}
            </Notice>
          )}
        </Card>
      </div>

      {created && (
        <section
          role="status"
          aria-label="New API key"
          className="tg-fade-in overflow-hidden rounded-md border-2 border-copper bg-copper-wash"
        >
          <div className="flex items-start gap-3 border-b border-copper/30 px-5 py-4">
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="mt-0.5 size-5 shrink-0 text-copper-deep"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10 2.5 18 16.5H2L10 2.5Z" />
              <path d="M10 8v3.5M10 14h.01" />
            </svg>
            <div>
              <p className="font-mono text-base font-semibold text-ink">
                Copy this key now: it is shown only once
              </p>
              <p className="mt-0.5 text-[15px] text-ink">
                New key for <span className="font-medium">{created.name}</span>. It cannot be
                retrieved later. If you lose it, revoke it and create another.
              </p>
            </div>
          </div>
          <div className="space-y-3 px-5 py-4">
            <div className="flex flex-wrap items-stretch gap-3">
              <code className="min-w-0 flex-1 rounded-md bg-ink px-4 py-3 font-mono text-sm leading-6 break-all text-paper select-all">
                {created.key}
              </code>
              <Button variant="primary" className="min-w-28 px-5" onClick={copyCreatedKey}>
                {copied ? "Copied ✓" : "Copy key"}
              </Button>
            </div>
            {copyError && <p className="text-sm font-medium text-error">{copyError}</p>}
            <Button className="bg-transparent" onClick={dismissCreated}>
              I have copied it. Hide the key.
            </Button>
          </div>
        </section>
      )}

      <section aria-labelledby="keys-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <SectionTitle>
              <span id="keys-heading">Keys</span>
            </SectionTitle>
            {keys.length > 0 && <Badge>{keys.length}</Badge>}
          </div>
          <Button variant="ghost" onClick={() => setRefreshToken((n) => n + 1)} disabled={listLoading}>
            {listLoading ? "Loading…" : "Refresh"}
          </Button>
        </div>
        {!adminKey && apiKey && (
          <Notice>Showing only the saved API key. Save the admin key above to see all keys.</Notice>
        )}
        {listError && (
          <Notice tone="error" role="alert">
            {listError}
          </Notice>
        )}
        {actionError && (
          <Notice tone="error" role="alert">
            {actionError}
          </Notice>
        )}
        <Card padding="p-0" className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-rule bg-paper/60 font-mono text-xs tracking-wider text-muted uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Prefix</th>
                <th className="px-4 py-3 text-right font-medium">RPM</th>
                <th className="px-4 py-3 font-medium">Cache</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Last used</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {keys.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    {listLoading ? (
                      <div className="space-y-3 px-4 py-4" aria-hidden="true">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-full" />
                      </div>
                    ) : adminKey || apiKey ? (
                      <EmptyState title="No keys yet">Create one above to start sending requests.</EmptyState>
                    ) : (
                      <EmptyState title="Nothing to list">
                        Save an admin key above to list every key, or an API key in the top bar to list
                        just that one.
                      </EmptyState>
                    )}
                  </td>
                </tr>
              )}
              {keys.map((key) => {
                const revoked = key.revoked_at !== null;
                return (
                  <tr key={key.id} className="align-middle transition-colors hover:bg-paper/50">
                    <td className={`px-4 py-3 font-medium ${revoked ? "text-muted" : ""}`}>{key.name}</td>
                    <td className="px-4 py-3 font-mono text-[13px]">{key.prefix}…</td>
                    <td className="px-4 py-3 text-right font-mono text-[13px]">{key.rate_limit_rpm}</td>
                    <td className="px-4 py-3">
                      <Badge tone={key.cache_enabled ? "ok" : "neutral"}>
                        {key.cache_enabled ? "on" : "off"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">{formatDateTime(key.created_at)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">
                      {key.last_used_at ? formatDateTime(key.last_used_at) : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      {revoked ? (
                        <div className="flex flex-col items-start gap-1">
                          <Badge tone="error">Revoked</Badge>
                          <span className="text-[13px] whitespace-nowrap text-muted">
                            {formatDateTime(key.revoked_at)}
                          </span>
                        </div>
                      ) : (
                        <Badge tone="ok">Active</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!revoked && (
                        <Button
                          className="px-2.5 py-1"
                          disabled={!adminKey || revokingId === key.id}
                          title={adminKey ? undefined : "Revoking needs the admin key"}
                          onClick={() => onRevoke(key)}
                        >
                          {revokingId === key.id ? "Revoking…" : "Revoke"}
                        </Button>
                      )}
                      {revoked && <span className="text-muted">{EMPTY}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}
