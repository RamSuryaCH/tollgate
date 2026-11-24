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
import { Badge, Button, Card, inputClass, Notice, SectionTitle } from "@/components/ui";

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
      <Card className="space-y-4">
        <SectionTitle>Admin key</SectionTitle>
        <form onSubmit={saveAdminKey} className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1 space-y-1.5">
            <label htmlFor="admin-key" className="block text-sm">
              Admin key
            </label>
            <input
              id="admin-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={shownAdminKey}
              onChange={(e) => setAdminDraft(e.target.value)}
              className={`${inputClass} font-mono text-xs`}
            />
          </div>
          <Button type="submit" variant="secondary">
            Save
          </Button>
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
        </form>
        <p className="text-xs leading-relaxed text-muted">
          Creating and revoking keys need the admin key, sent as X-Admin-Key. It is stored in this
          browser only. Listing uses the admin key when one is saved; otherwise it uses the API key
          and shows only that key.
        </p>
      </Card>

      <Card className="space-y-5">
        <SectionTitle>Create key</SectionTitle>
        <form onSubmit={onCreate} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
          <div className="space-y-1.5">
            <label htmlFor="key-name" className="block text-sm">
              Name
            </label>
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
            <label htmlFor="key-rpm" className="block text-sm">
              Requests per minute
            </label>
            <input
              id="key-rpm"
              type="number"
              min={1}
              max={MAX_RPM}
              step={1}
              value={rpm}
              onChange={(e) => setRpm(e.target.value)}
              className={`${inputClass} font-mono text-xs`}
            />
          </div>
          <label className="flex items-center gap-2.5 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={cacheEnabled}
              onChange={(e) => setCacheEnabled(e.target.checked)}
              className="size-4 accent-copper"
            />
            Cache enabled
            <span className="text-xs text-muted">(cached only for non-streamed, temperature 0 requests)</span>
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" variant="primary" disabled={creating || !adminKey}>
              {creating ? "Creating…" : "Create key"}
            </Button>
            {!adminKey && <span className="text-sm text-muted">Save the admin key above first.</span>}
          </div>
        </form>
        {formError && (
          <Notice tone="error" role="alert">
            {formError}
          </Notice>
        )}

        {created && (
          <div className="space-y-4 rounded-md border border-copper bg-paper p-5" role="status">
            <div>
              <p className="font-medium">New key for {created.name}</p>
              <p className="mt-1 text-sm font-medium text-error">
                This is the only time the full key is shown. Copy it now. It cannot be retrieved later.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <code className="font-mono text-sm break-all select-all rounded-md border border-rule bg-card px-3 py-2">
                {created.key}
              </code>
              <Button variant="primary" onClick={copyCreatedKey}>
                {copied ? "Copied" : "Copy key"}
              </Button>
            </div>
            {copyError && <p className="text-sm text-error">{copyError}</p>}
            <Button variant="ghost" onClick={dismissCreated}>
              I have copied it. Hide the key.
            </Button>
          </div>
        )}
      </Card>

      <section aria-labelledby="keys-heading" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <SectionTitle>
            <span id="keys-heading">Keys</span>
          </SectionTitle>
          <Button variant="ghost" onClick={() => setRefreshToken((n) => n + 1)} disabled={listLoading}>
            {listLoading ? "Loading…" : "Refresh"}
          </Button>
        </div>
        {!adminKey && apiKey && (
          <Notice>Showing only the saved API key. Save the admin key above to see all keys.</Notice>
        )}
        {!adminKey && !apiKey && <Notice>Save an admin key above to list keys.</Notice>}
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
        {(adminKey || apiKey) && (
          <Card padding="p-0" className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-rule font-mono text-xs tracking-wide text-muted uppercase">
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
                    <td colSpan={8} className="px-4 py-6 text-muted">
                      {listLoading ? "Loading…" : "No keys yet."}
                    </td>
                  </tr>
                )}
                {keys.map((key) => {
                  const revoked = key.revoked_at !== null;
                  return (
                    <tr key={key.id} className="align-middle">
                      <td className="px-4 py-2.5 font-medium">{key.name}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{key.prefix}…</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{key.rate_limit_rpm}</td>
                      <td className="px-4 py-2.5">
                        <Badge tone="neutral">
                          {key.cache_enabled ? "on" : "off"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-xs whitespace-nowrap text-muted">
                        {formatDateTime(key.created_at)}
                      </td>
                      <td className="px-4 py-2.5 text-xs whitespace-nowrap text-muted">
                        {key.last_used_at ? formatDateTime(key.last_used_at) : "Never"}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {revoked ? (
                          <span className="text-error">Revoked {formatDateTime(key.revoked_at)}</span>
                        ) : (
                          <span className="text-ok">Active</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {!revoked && (
                          <Button
                            variant="secondary"
                            className="px-2.5 py-1 text-xs"
                            disabled={!adminKey || revokingId === key.id}
                            title={adminKey ? undefined : "Revoking needs the admin key"}
                            onClick={() => onRevoke(key)}
                          >
                            {revokingId === key.id ? "Revoking…" : "Revoke"}
                          </Button>
                        )}
                        {revoked && <span className="text-xs text-muted">{EMPTY}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}
