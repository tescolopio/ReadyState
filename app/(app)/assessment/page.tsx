"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { PageHeader } from "@/components/app-shell";
import { HouseholdWizard, InventoryCheck } from "@/components/household-wizard";
import { HouseholdSaves } from "@/components/household-saves";
import { Button } from "@/components/ui/button";
import { hasAssessmentAnswers } from "@/lib/household";
import { createAssessmentRecord } from "@/lib/local-records";
import { assessInventory } from "@/lib/inventory";
import { useHouseholdStore } from "@/store/useHouseholdStore";
import { useLocalRecordsStore } from "@/store/useLocalRecordsStore";

const noSubscribe = () => () => {};
const topics = ["People", "Pets", "Home", "Health needs", "Supplies", "Review"] as const;

export default function AssessmentPage() {
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  return hydrated ? <AssessmentContent /> : <main className="flex-1" />;
}

function AssessmentContent() {
  const profile = useHouseholdStore(state => state.profile);
  const records = useLocalRecordsStore();
  const [topic, updateTopic] = useState<number | null>(() => records.data.progress === "auto"
    ? hasAssessmentAnswers(profile) ? null : 0 : records.data.progress);
  const [saveError, setSaveError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const progress = useCallback((next: number | null) => {
    try {
      const current = useLocalRecordsStore.getState();
      if (current.error) throw new Error(current.error);
      current.commit({ ...current.data, progress: next });
    } catch { useLocalRecordsStore.setState({ error: "Assessment progress could not be saved. Check browser storage; do not rely on resuming this step after reload." }); }
  }, []);
  useEffect(() => progress(topic), [progress, topic]);
  const setTopic = updateTopic;
  const [revision, setRevision] = useState(0);
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-6">
      <PageHeader title="Household assessment"
        intro="Describe your household, review relevant topics and choose a few next steps. This assessment runs in your browser without AI, an API key or an exercise." />
      <HouseholdSaves onRestore={() => { setRevision(value => value + 1); setTopic(null); }} />
      <Link href="/settings#backups" className="inline-block font-semibold underline">Full encrypted backups, including saved API keys and history</Link>
      {(saveError || records.error) && <p role="alert">{saveError || records.error}</p>}
      {saveNotice && <p role="status">{saveNotice}</p>}
      {topic !== null ? (
        <HouseholdWizard key={`${revision}-${topic}`} purpose="assessment" initialStep={topic}
          onStepChange={progress}
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
          <div className="space-y-2">
            <Button variant="outline" onClick={() => {
              setSaveNotice(""); setSaveError("");
              try {
                if (records.error) throw new Error(records.error);
                records.commit({ ...records.data, assessments: [...records.data.assessments, createAssessmentRecord(profile)] });
                setSaveNotice("Dated assessment saved locally. Read it in Journal; it will not change with later answers.");
              } catch { setSaveError("Assessment record could not be saved. Browser storage may be unavailable/full or existing records invalid."); }
            }}>Save dated assessment</Button>
            <p className="text-sm text-ink-3">Keeps these answers, explanations, next steps and sources as a historical record in this browser, unencrypted.</p>
          </div>
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
