"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/config";
import { errorMessage, fetchHealth } from "@/lib/api";

const POLL_MS = 15_000;

type Status =
  | { kind: "checking" }
  | { kind: "ok" }
  | { kind: "degraded"; detail: string }
  | { kind: "down"; detail: string };

const dotClass: Record<Status["kind"], string> = {
  checking: "bg-faint/50",
  ok: "bg-ok",
  degraded: "bg-copper",
  down: "bg-error",
};

export function ConnectionStatus() {
  const [status, setStatus] = useState<Status>({ kind: "checking" });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const health = await fetchHealth(AbortSignal.timeout(4000));
        if (cancelled) return;
        if (health.status === "ok") {
          setStatus({ kind: "ok" });
        } else {
          const failing = [
            health.postgres !== "ok" ? "Postgres" : null,
            health.redis !== "ok" ? "Redis" : null,
          ].filter(Boolean);
          setStatus({
            kind: "degraded",
            detail: `${failing.join(" and ") || "a dependency"} unavailable`,
          });
        }
      } catch (err) {
        if (cancelled) return;
        setStatus({ kind: "down", detail: errorMessage(err) });
      }
    }

    void check();
    const timer = window.setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const label =
    status.kind === "checking"
      ? "Checking API"
      : status.kind === "ok"
        ? "API ok"
        : status.kind === "degraded"
          ? "API degraded"
          : "API unreachable";

  const title = status.kind === "degraded" || status.kind === "down" ? status.detail : API_URL;

  return (
    <div
      className="flex h-8 items-center gap-2 font-mono text-[13px] text-muted"
      title={title}
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true" className={`inline-block size-2 rounded-full ${dotClass[status.kind]}`} />
      <span>{label}</span>
      <span className="hidden text-muted xl:inline">{API_URL.replace(/^https?:\/\//, "")}</span>
    </div>
  );
}
