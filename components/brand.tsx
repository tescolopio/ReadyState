import Link from "next/link";

/**
 * The ReadyState mark. Each style shows its own concept so the A/B test
 * compares whole treatments (decision D7):
 * - Style A (design brief §4): a path through three points with a deliberate
 *   gap before the last one, "the next step".
 * - Style B (Modern treatment §4): dots gathering into a solid home.
 * Both are concept marks, not approved logos (work item DS3).
 */
export function Mark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <span className={className} aria-hidden>
      <svg viewBox="0 0 32 32" className="style-a-only h-full w-full" fill="none">
        <path d="M5 24 C 9 24, 11 12, 16 12 S 21 18, 23.5 15.5" stroke="var(--rs-action)" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="5" cy="24" r="3" fill="var(--rs-action)" />
        <circle cx="16" cy="12" r="3" fill="var(--rs-action)" />
        <circle cx="27.5" cy="12.5" r="3" fill="none" stroke="var(--rs-attention-accent)" strokeWidth="2" />
      </svg>
      <svg viewBox="0 0 32 32" className="style-b-only h-full w-full" fill="none">
        <circle cx="3.5" cy="22" r="1.5" fill="var(--rs-action)" opacity="0.45" />
        <circle cx="7" cy="15" r="1.75" fill="var(--rs-action)" opacity="0.65" />
        <circle cx="9.5" cy="24" r="2" fill="var(--rs-action)" opacity="0.8" />
        <path d="M14 16.5 L21.5 10 L29 16.5 V27 H14 Z" fill="var(--rs-action)" />
        <rect x="19.5" y="20" width="4" height="7" fill="var(--rs-canvas)" />
      </svg>
    </span>
  );
}

export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded-control text-ink">
      <Mark />
      <span className="font-heading text-lg font-semibold tracking-tight">ReadyState</span>
    </Link>
  );
}

/** Marks exercise content so it can't be mistaken for a live emergency (Modern treatment §2). */
export function SimulationLabel() {
  return (
    <span className="rounded-full border border-attention-accent px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-attention">
      Simulation
    </span>
  );
}
