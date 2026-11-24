import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { UsageDashboard } from "@/components/usage-dashboard";

export const metadata: Metadata = { title: "Usage" };

export default function UsagePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Usage">Requests, tokens, cache hits, and latency for the saved key.</PageHeader>
      <UsageDashboard />
    </div>
  );
}
