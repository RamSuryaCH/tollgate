import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { Playground } from "@/components/playground";

// Absolute, because the root segment does not apply the layout title template.
export const metadata: Metadata = { title: { absolute: "Playground · Tollgate" } };

export default function PlaygroundPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Playground">Chat through the gateway with your API key.</PageHeader>
      <Playground />
    </div>
  );
}
