"use client";

import { BookOpen, Compass, Home, ListChecks, Settings, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore, type ReactNode } from "react";

import { Wordmark } from "@/components/brand";
import { householdLine } from "@/components/household-summary";
import { SiteFooter } from "@/components/site-footer";
import { useExerciseSession } from "@/lib/exercise-session";
import { hasProfile } from "@/lib/household";
import { useHouseholdStore } from "@/store/useHouseholdStore";

/**
 * The app's destinations (design brief §3, Modern treatment §6): a sidebar on
 * wide screens and labeled bottom navigation on phones (work item F13).
 */
const DESTINATIONS: { href: string; label: string; short: string; icon: LucideIcon; also?: string }[] = [
  { href: "/journal", label: "Journal", short: "Journal", icon: BookOpen },
  { href: "/exercises", label: "Exercises", short: "Practice", icon: Compass, also: "/exercise" },
  { href: "/household", label: "My household", short: "Home", icon: Home },
  { href: "/assessment", label: "Assessment", short: "Assess", icon: ListChecks },
  { href: "/plan", label: "Action plan", short: "Plan", icon: ListChecks },
  { href: "/settings", label: "Settings", short: "Settings", icon: Settings },
];

const noSubscribe = () => () => {};

/** Which household the app is working with, so a sample is never mistaken for your own (Modern treatment §6). */
function HouseholdContext() {
  const saved = useHouseholdStore((state) => state.profile);
  const { activeProfile, sampleId } = useExerciseSession();
  // The saved profile lives in localStorage, which the server render can't see.
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const profile = activeProfile ?? (hydrated && hasProfile(saved) ? saved : null);
  return (
    <Link href="/household" className="block rounded-control px-3 py-2 text-sm hover:bg-action-soft">
      <span className="block text-xs font-semibold text-ink-3">{sampleId ? "Sample household (fictional)" : "Household"}</span>
      <span className="block truncate text-ink">{profile ? householdLine(profile) : "Not set up yet"}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string, also?: string) =>
    pathname === href || pathname.startsWith(`${href}/`) || (also !== undefined && pathname === also);

  return (
    <div className="flex min-h-screen bg-canvas">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="px-5 py-4">
          <Wordmark />
        </div>
        <nav aria-label="App" className="px-3">
          <ul className="space-y-1">
            {DESTINATIONS.map(({ href, label, icon: Icon, also }) => {
              const active = isActive(href, also);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-3 rounded-control px-3 text-sm font-semibold ${
                      active ? "bg-action-soft text-ink" : "text-ink-2 hover:bg-action-soft hover:text-ink"
                    }`}
                  >
                    <Icon className={`h-5 w-5 ${active ? "text-action" : ""}`} aria-hidden />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="mt-auto border-t border-line p-3">
          <HouseholdContext />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-20 lg:pb-0">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface/95 px-4 py-2 backdrop-blur lg:hidden">
          <Wordmark />
          <div className="min-w-0 max-w-[55%]">
            <HouseholdContext />
          </div>
        </header>
        {children}
        <SiteFooter />
      </div>

      <nav aria-label="App" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface lg:hidden">
        <ul className="grid grid-cols-6">
          {DESTINATIONS.map(({ href, short, icon: Icon, also }) => {
            const active = isActive(href, also);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${
                    active ? "text-action" : "text-ink-2 hover:text-ink"
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                  {short}
                  {/* Status never relies on color alone (AC01). */}
                  <span className={`h-0.5 w-6 rounded-full ${active ? "bg-action" : "bg-transparent"}`} aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/** A page heading block shared by the app's destinations. */
export function PageHeader({ title, intro, children }: { title: string; intro?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold">{title}</h1>
        {intro && <p className="max-w-prose text-ink-2">{intro}</p>}
      </div>
      {children}
    </div>
  );
}
