import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { KeysAdmin } from "@/components/keys-admin";

export const metadata: Metadata = { title: "Keys" };

export default function KeysPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Keys">Create, list, and revoke API keys with the admin key.</PageHeader>
      <KeysAdmin />
    </div>
  );
}
