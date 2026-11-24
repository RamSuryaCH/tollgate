import type { Metadata } from "next";
import { UsageDashboard } from "@/components/usage-dashboard";

export const metadata: Metadata = { title: "Usage" };

export default function UsagePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-xl font-semibold tracking-tight">Usage</h1>
        <p className="mt-1 text-sm text-muted">Requests, tokens, cache hits, and latency for the saved key.</p>
      </div>
      <UsageDashboard />
    </div>
  );
}
