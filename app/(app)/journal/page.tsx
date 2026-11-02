"use client";

import { useChat } from "@ai-sdk/react";
import { ArrowRight, BookOpen, Play } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";

import { PageHeader } from "@/components/app-shell";
import { SimulationLabel } from "@/components/brand";
import { LocalHistory } from "@/components/local-history";
import { exerciseChat, useExerciseSession } from "@/lib/exercise-session";
import { SCENARIOS, hasProfile } from "@/lib/household";
import { deriveTtxState } from "@/lib/ttx";
import { useHouseholdStore } from "@/store/useHouseholdStore";
import { usePlanStore } from "@/store/usePlanStore";
import { unmaskOutput } from "@/utils/obfuscator";

const noSubscribe = () => () => {};

const primaryLink =
  "inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-4 text-sm font-semibold text-on-action hover:bg-action-hover";
const secondaryLink =
  "inline-flex min-h-11 items-center gap-2 rounded-control border border-line-strong px-4 text-sm font-semibold hover:bg-action-soft";

/** The first sentence, for a one-line recap. */
const firstSentence = (text: string) => text.match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? text;

/**
 * Journal home (design brief §3, Modern treatment §7.3): one "Resume
 * exercise" panel, then unfinished actions. Counts appear only when backed by
 * real records; no scores, streaks or charts.
 */
export default function JournalPage() {
  const { messages } = useChat({ chat: exerciseChat });
  const { activeProfile, sampleId } = useExerciseSession();
  const profile = useHouseholdStore((state) => state.profile);
  const plan = usePlanStore((state) => state.items);
  // The profile and plan live in localStorage, which the server render can't see.
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);

  const ttx = deriveTtxState(messages);
  const scenario = activeProfile && activeProfile.scenario !== "surprise" ? SCENARIOS[activeProfile.scenario] : "Your exercise";
  const latest = ttx.latestTurn;
  const open = plan.filter((item) => item.status !== "done");

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-6">
      <PageHeader title="Journal" />

      {messages.length > 0 ? (
        <section aria-labelledby="resume" className="space-y-3 rounded-panel border border-line bg-surface p-6 shadow-panel">
          <div className="flex flex-wrap items-center gap-2">
            <SimulationLabel />
            {sampleId && <span className="text-sm text-ink-3">Sample, fictional household</span>}
          </div>
          <h2 id="resume" className="text-2xl font-semibold">
            {scenario}
          </h2>
          {ttx.phase === "aar" ? (
            <p className="text-ink-2">Finished. Your debrief is ready to read.</p>
          ) : (
            <>
              <p className="text-sm font-semibold text-ink-3">
                Paused at {latest?.time_elapsed ?? "the start"} · {ttx.turns.length} {ttx.turns.length === 1 ? "situation" : "situations"} so far
              </p>
              {latest?.new_inject && <p className="max-w-prose text-ink-2">{firstSentence(unmaskOutput(latest.new_inject))}</p>}
            </>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/exercise" className={primaryLink}>
              <Play className="h-4 w-4" aria-hidden />
              {ttx.phase === "aar" ? "Read the debrief" : "Resume exercise"}
            </Link>
            <span className="text-xs text-ink-3">Save a snapshot below before closing or reloading; later changes are not autosaved.</span>
          </div>
        </section>
      ) : (
        <section className="space-y-3 rounded-panel border border-line bg-surface p-6 shadow-panel">
          <BookOpen className="h-6 w-6 text-action" aria-hidden />
          <h2 className="text-2xl font-semibold">Ready when you are</h2>
          <p className="max-w-prose text-ink-2">
            Each exercise is a developing emergency, one decision at a time. You write what you&apos;d do, then see what you
            covered, what to consider and why it matters.
          </p>
          {hydrated && (
            <div className="flex flex-wrap gap-3">
              {hasProfile(profile) ? (
                <Link href="/exercises" className={primaryLink}>
                  Choose an exercise
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              ) : (
                <>
                  <Link href="/household?setup=1" className={primaryLink}>
                    Set up my household
                  </Link>
                  <Link href="/exercise?sample=alex" className={secondaryLink}>
                    Try a sample exercise
                  </Link>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {hydrated && (
        <section aria-labelledby="actions" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="actions" className="text-lg font-semibold">
              {open.length === 0 ? "No open actions" : `${open.length} ${open.length === 1 ? "action" : "actions"} remaining`}
            </h2>
            <Link href="/plan" className="text-sm font-semibold underline underline-offset-4">
              Action plan
            </Link>
          </div>
          {open.length === 0 ? (
            <p className="text-ink-2">Steps you keep during an exercise show up here.</p>
          ) : (
            <ul className="divide-y divide-line rounded-panel border border-line bg-surface">
              {open.slice(0, 3).map((item) => (
                <li key={item.id} className="px-4 py-3">
                  <p>{item.text}</p>
                  <p className="text-sm text-ink-3">From {item.source}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="text-sm text-ink-3">
        The live exercise stays in this tab. Save a snapshot below before closing or reloading; later changes are not automatically added to that snapshot.
      </p>
      {hydrated && <LocalHistory />}
    </main>
  );
}
