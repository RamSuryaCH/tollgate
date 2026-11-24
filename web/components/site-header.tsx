"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ApiKeyControl } from "@/components/api-key-control";
import { ConnectionStatus } from "@/components/connection-status";

const NAV = [
  { href: "/", label: "Playground" },
  { href: "/usage", label: "Usage" },
  { href: "/keys", label: "Keys" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-6 pt-5 pb-4">
        <div>
          <Link href="/" className="font-mono text-lg font-semibold tracking-tight text-ink">
            Tollgate
          </Link>
          <p className="text-sm text-muted">A self-hosted chat gateway.</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <ConnectionStatus />
          <ApiKeyControl />
        </div>
      </div>
      <nav aria-label="Main" className="mx-auto flex max-w-6xl gap-6 px-6">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`-mb-px border-b-2 pb-2.5 text-sm transition-colors ${
                active
                  ? "border-copper font-medium text-ink"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
