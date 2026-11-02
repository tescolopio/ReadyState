"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

import { PageHeader } from "@/components/app-shell";
import { HouseholdWizard, InventoryCheck } from "@/components/household-wizard";
import { Button } from "@/components/ui/button";
import { hasAssessmentAnswers } from "@/lib/household";
import { assessInventory } from "@/lib/inventory";
import { useHouseholdStore } from "@/store/useHouseholdStore";

const noSubscribe = () => () => {};
const topics = ["People", "Pets", "Home", "Health needs", "Supplies", "Review"] as const;

export default function AssessmentPage() {
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  return hydrated ? <AssessmentContent /> : <main className="flex-1" />;
}

function AssessmentContent() {
  const profile = useHouseholdStore(state => state.profile);
  const [topic, setTopic] = useState<number | null>(() => hasAssessmentAnswers(profile) ? null : 0);
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-6">
      <PageHeader title="Household assessment"
        intro="Describe your household, review relevant topics and choose a few next steps. This assessment runs in your browser without AI, an API key or an exercise." />
      {topic !== null ? (
        <HouseholdWizard key={topic} purpose="assessment" initialStep={topic}
          onStart={() => setTopic(null)} onClose={() => setTopic(null)} />
      ) : (
        <>
          <section aria-label="Review household topics" className="space-y-2">
            <h2 className="text-lg font-semibold">Add detail when it helps</h2>
            <p className="text-sm text-ink-2">Use a short profile now and return later. Answers are shared with My household, not copied into a second profile.</p>
            <div className="flex flex-wrap gap-2">
              {topics.map((label, index) => <Button key={label} variant="outline" onClick={() => setTopic(index)}>{label}</Button>)}
            </div>
            <p className="text-sm text-ink-3">Dedicated communication and evacuation planning questions are a later increment. Existing related guidance is not proof that you lack a plan.</p>
          </section>
          <InventoryCheck findings={assessInventory(profile, { scenario: false })} />
          <div className="flex flex-wrap gap-4">
            <Link href="/plan" className="font-semibold underline">View my action plan</Link>
            <Link href="/exercises" className="underline">Practice with this household (optional)</Link>
          </div>
          <p className="text-sm text-ink-3">Saved in this browser&apos;s local storage, not an encrypted vault. Shared-device users may be able to read it. Assessment answers and plan actions do not contact a provider. Exercises retain review-before-send.</p>
        </>
      )}
    </main>
  );
}
