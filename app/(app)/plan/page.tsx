"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";

import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { assessInventory, gaps } from "@/lib/inventory";
import { useHouseholdStore } from "@/store/useHouseholdStore";
import { PLAN_STATUSES, usePlanStore, type PlanItem, type PlanStatus } from "@/store/usePlanStore";

const noSubscribe = () => () => {};

/**
 * The action plan (design brief UX04, Modern treatment §7.7): steps kept from
 * exercises and from the household's inventory check, with Open, In progress
 * and Done. No due dates are imposed, and finishing a step doesn't certify
 * that a risk is gone.
 */
export default function PlanPage() {
  const items = usePlanStore((state) => state.items);
  const add = usePlanStore((state) => state.add);
  const profile = useHouseholdStore((state) => state.profile);
  // The plan and profile live in localStorage, which the server render can't see.
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const suggestions = useMemo(
    () => gaps(assessInventory(profile, { scenario: false })).filter((finding) => finding.action),
    [profile],
  );

  if (!hydrated) return <main className="flex-1" />;
  const active = items.filter((item) => item.status !== "done");
  const done = items.filter((item) => item.status === "done");
  const untracked = suggestions.filter((finding) => !items.some((item) => item.text === finding.action));

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-6">
      <PageHeader
        title="Action plan"
        intro="Practical steps you chose to keep. Mark them as you go; finishing one is progress, not a guarantee."
      />
      <p className="text-sm text-ink-2">
        Saved actions reflect the answers or exercise at the time you chose them, not a live list of deficiencies.
        Changing answers does not rewrite, remove or complete an action.{" "}
        <Link href="/assessment" className="underline">Review your current assessment</Link>
        {" "}and keep, complete or remove earlier actions as appropriate.
      </p>

      <section aria-labelledby="plan-active" className="space-y-3">
        <h2 id="plan-active" className="text-lg font-semibold">
          {active.length === 0 ? "Nothing open" : `${active.length} ${active.length === 1 ? "step" : "steps"} to do`}
        </h2>
        {active.length === 0 ? (
          <p className="rounded-panel border border-dashed border-line-strong p-5 text-ink-2">
            Save a practical step from your household assessment. No exercise or AI is required.{" "}
            <Link href="/assessment" className="font-semibold text-ink underline underline-offset-2">
              Assess my household
            </Link>
          </p>
        ) : (
          <ul className="space-y-2">
            {active.map((item) => (
              <PlanRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>

      {untracked.length > 0 && (
        <section aria-labelledby="plan-suggested" className="space-y-3">
          <h2 id="plan-suggested" className="text-lg font-semibold">
            Suggested by your household check
          </h2>
          <p className="text-sm text-ink-2">From comparing your supplies with Ready.gov and CDC guidance. Add the ones you want to act on.</p>
          <ul className="space-y-2">
            {untracked.map((finding, index) => (
              // Rules can share a finding id (one per person, several needs), so the position keeps keys unique.
              <li key={`${finding.id}-${index}`} className="flex flex-wrap items-start justify-between gap-3 rounded-panel border border-line bg-surface p-4">
                <div className="min-w-0 flex-1 basis-64">
                  <p>
                    <span className="mr-2 rounded border border-line-strong px-1.5 py-0.5 text-xs font-semibold text-ink-2">
                      {finding.kind === "plan" ? "Plan" : "Get"}
                    </span>
                    {finding.action}
                  </p>
                  <p className="mt-1 text-sm text-ink-3">{finding.finding}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => add({ text: finding.action!, source: "Household check", kind: finding.kind })}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Add to my plan
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {done.length > 0 && (
        <details className="rounded-panel border border-line bg-surface">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 font-semibold">Done ({done.length})</summary>
          <ul className="space-y-2 border-t border-line p-4">
            {done.map((item) => (
              <PlanRow key={item.id} item={item} />
            ))}
          </ul>
        </details>
      )}

      <p className="text-sm text-ink-3">Your plan is saved in this browser only.</p>
    </main>
  );
}

function PlanRow({ item }: { item: PlanItem }) {
  const setStatus = usePlanStore((state) => state.setStatus);
  const remove = usePlanStore((state) => state.remove);
  const selectId = `status-${item.id}`;
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-panel border border-line bg-surface p-4 shadow-panel">
      <div className="min-w-0 flex-1 basis-64">
        <p className={item.status === "done" ? "text-ink-2 line-through" : ""}>
          {item.kind && <span className="mr-2 rounded border border-line-strong px-1.5 py-0.5 text-xs font-semibold text-ink-2 no-underline">{item.kind === "plan" ? "Plan" : "Get"}</span>}
          {item.text}
        </p>
        <p className="mt-1 text-sm text-ink-3">
          From {item.source} · Saved <time dateTime={item.addedAt}>{item.addedAt.slice(0, 10)}</time>
        </p>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={selectId} className="sr-only">
          Status
        </label>
        <select
          id={selectId}
          value={item.status}
          onChange={(event) => setStatus(item.id, event.target.value as PlanStatus)}
          className="min-h-11 rounded-control border border-line-strong bg-field px-2 text-sm text-ink"
        >
          {Object.entries(PLAN_STATUSES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Button variant="ghost" size="icon" onClick={() => remove(item.id)} aria-label={`Remove: ${item.text}`}>
          <Trash2 className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </li>
  );
}
