import type { Metadata } from "next";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: { default: "Tollgate", template: "%s · Tollgate" },
  description: "A self-hosted chat gateway.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-paper text-ink antialiased">
        <SiteHeader />
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
        <footer className="border-t border-rule">
          <div className="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-1 px-6 py-4 font-mono text-xs text-muted">
            <span>Ram Surya Chelluboyina</span>
            <a
              href="https://github.com/RamSuryaCH"
              className="underline decoration-rule underline-offset-4 hover:text-ink"
            >
              GitHub RamSuryaCH
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
