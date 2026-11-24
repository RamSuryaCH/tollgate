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

/** One 56px bar: product name and nav on the left, connection status and API key on the right. */
export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="border-b border-rule bg-card/60">
      <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-stretch justify-between gap-x-8 px-6">
        <div className="flex items-stretch gap-8">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-sm font-mono text-lg font-semibold tracking-tight text-ink"
          >
            <span aria-hidden="true" className="size-2.5 rounded-[2px] bg-copper" />
            Tollgate
          </Link>
          <nav aria-label="Main" className="flex items-stretch gap-6">
            {NAV.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`-mb-px flex items-center border-b-2 text-sm transition-colors ${
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
        </div>
        <div className="flex items-center gap-5 py-2">
          <ConnectionStatus />
          <span aria-hidden="true" className="h-5 w-px bg-rule" />
          <ApiKeyControl />
        </div>
      </div>
    </header>
  );
}
