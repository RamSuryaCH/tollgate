import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "border-copper bg-copper text-white hover:bg-copper-deep hover:border-copper-deep",
  secondary: "border-rule bg-card text-ink hover:border-muted",
  ghost: "border-transparent bg-transparent text-muted hover:text-ink hover:border-rule",
};

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-md border px-3.5 py-2 text-sm leading-5 font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${buttonVariants[variant]} ${className}`}
      {...rest}
    />
  );
}

export const inputClass =
  "w-full rounded-md border border-rule bg-card px-3 py-2 text-sm leading-5 text-ink placeholder:text-faint hover:border-muted/60 focus:border-muted disabled:opacity-60 disabled:hover:border-rule";

/** Label shown above a form field. */
export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
      {children}
    </label>
  );
}

export function Card({
  children,
  className = "",
  padding = "p-5",
}: {
  children: ReactNode;
  className?: string;
  /** Tailwind padding class. Defaults to p-5. Pass "p-0" for flush content such as tables. */
  padding?: string;
}) {
  return (
    <section className={`rounded-md border border-rule bg-card ${padding} ${className}`}>
      {children}
    </section>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-mono text-xs font-medium tracking-wider text-muted uppercase">{children}</h2>
  );
}

/** Page title block shared by every route, so the three pages start the same way. */
export function PageHeader({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-rule pb-5">
      <h1 className="font-mono text-2xl leading-8 font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 max-w-prose text-[15px] text-muted">{children}</p>
    </div>
  );
}

type BadgeTone = "hit" | "ok" | "miss" | "neutral" | "error";

const badgeTones: Record<BadgeTone, string> = {
  hit: "border-ok/35 bg-ok/10 text-ok",
  ok: "border-ok/35 bg-ok/10 text-ok",
  miss: "border-copper/40 bg-copper/10 text-copper-deep",
  neutral: "border-rule bg-paper/70 text-muted",
  error: "border-error/40 bg-error/10 text-error",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-xs leading-4 font-medium whitespace-nowrap ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Notice({
  tone = "info",
  children,
  role,
}: {
  tone?: "info" | "error";
  children: ReactNode;
  role?: "alert" | "status";
}) {
  const styles =
    tone === "error"
      ? "border-error/40 bg-error/5 text-error"
      : "border-rule bg-card text-ink";
  return (
    <div role={role} className={`rounded-md border px-4 py-3 text-sm leading-relaxed ${styles}`}>
      {children}
    </div>
  );
}

/** A quiet placeholder for "nothing here yet": a short title and one line of guidance. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-10 text-center">
      <p className="font-mono text-sm font-medium text-ink">{title}</p>
      {children && <p className="mt-1.5 text-sm text-muted">{children}</p>}
    </div>
  );
}

/** Placeholder bar that pulses while data loads. Pass width and height classes. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`tg-skeleton block ${className}`} />;
}
