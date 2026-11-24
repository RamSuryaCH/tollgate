import type { Metadata } from "next";
import { KeysAdmin } from "@/components/keys-admin";

export const metadata: Metadata = { title: "Keys" };

export default function KeysPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-xl font-semibold tracking-tight">Keys</h1>
        <p className="mt-1 text-sm text-muted">Create, list, and revoke API keys with the admin key.</p>
      </div>
      <KeysAdmin />
    </div>
  );
}
