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
      className={`inline-flex items-center justify-center gap-2 rounded-md border px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${buttonVariants[variant]} ${className}`}
      {...rest}
    />
  );
}

export const inputClass =
  "w-full rounded-md border border-rule bg-card px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-muted disabled:opacity-60";

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
    <h2 className="font-mono text-xs font-medium tracking-wide text-muted uppercase">{children}</h2>
  );
}

type BadgeTone = "hit" | "miss" | "neutral" | "error";

const badgeTones: Record<BadgeTone, string> = {
  hit: "border-ok/40 text-ok",
  miss: "border-copper/50 text-ink",
  neutral: "border-rule text-muted",
  error: "border-error/40 text-error",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-xs leading-4 ${badgeTones[tone]}`}
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
    <div role={role} className={`rounded-md border px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}
