import type { Metadata } from "next";
import { Playground } from "@/components/playground";

// Absolute, because the root segment does not apply the layout title template.
export const metadata: Metadata = { title: { absolute: "Playground · Tollgate" } };

export default function PlaygroundPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-xl font-semibold tracking-tight">Playground</h1>
        <p className="mt-1 text-sm text-muted">Chat through the gateway with your API key.</p>
      </div>
      <Playground />
    </div>
  );
}
