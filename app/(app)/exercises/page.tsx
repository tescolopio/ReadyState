"use client";

import { useChat } from "@ai-sdk/react";
import { Play, Sparkles, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";

import { PageHeader } from "@/components/app-shell";
import { householdLine } from "@/components/household-summary";
import { Button } from "@/components/ui/button";
import { exerciseChat, resetExercise } from "@/lib/exercise-session";
import { SCENARIOS, SCENARIO_SUMMARIES, hasProfile, type ScenarioId } from "@/lib/household";
import { deriveTtxState } from "@/lib/ttx";
import { useHouseholdStore } from "@/store/useHouseholdStore";

const noSubscribe = () => () => {};
const LIBRARY = (Object.keys(SCENARIOS) as ScenarioId[]).filter((id) => id !== "surprise");

/**
 * The exercise library (Modern treatment §7.4): one card per emergency, the
 * household it will run for, and a way back to an exercise in progress.
 * Round counts and continuing practice are open decisions, so they aren't shown.
 */
export default function ExercisesPage() {
  const router = useRouter();
  const profile = useHouseholdStore((state) => state.profile);
  const setProfile = useHouseholdStore((state) => state.setProfile);
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const { messages } = useChat({ chat: exerciseChat });
  const inProgress = messages.length > 0 && deriveTtxState(messages).phase !== "aar";
  const ready = hydrated && hasProfile(profile);

  const start = (scenario: ScenarioId) => {
    resetExercise();
    setProfile({ ...profile, scenario });
    router.push("/exercise?start=1");
  };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-6">
      <PageHeader title="Exercises" intro="Pick an emergency to practice. The situation develops from your household: who's home, your pets, your home and your supplies." />

      {inProgress && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-attention-accent bg-attention-soft p-4">
          <p>
            <strong>You have an exercise in progress.</strong> Starting another one ends it.
          </p>
          <Link
            href="/exercise"
            className="inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-4 text-sm font-semibold text-on-action hover:bg-action-hover"
          >
            Resume exercise
          </Link>
        </section>
      )}

      {hydrated && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line bg-surface p-4">
          <div className="flex items-center gap-3">
            <User className="h-5 w-5 text-action" aria-hidden />
            <div>
              <p className="text-xs font-semibold text-ink-3">Practicing as</p>
              <p className="font-semibold">{ready ? householdLine(profile) : "No household yet"}</p>
            </div>
          </div>
          {ready ? (
            <Link href="/household" className="rounded-control px-2 py-2 text-sm font-semibold underline underline-offset-4">
              Review household
            </Link>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Link
                href="/household?setup=1"
                className="inline-flex min-h-11 items-center rounded-control bg-action px-4 text-sm font-semibold text-on-action hover:bg-action-hover"
              >
                Set up my household
              </Link>
              <Link
                href="/exercise?sample=alex"
                className="inline-flex min-h-11 items-center rounded-control border border-line-strong px-4 text-sm font-semibold hover:bg-action-soft"
              >
                Try a sample first
              </Link>
            </div>
          )}
        </section>
      )}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...LIBRARY, "surprise" as const].map((id) => (
          <li key={id} className="flex flex-col rounded-panel border border-line bg-surface p-5 shadow-panel">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-semibold">{SCENARIOS[id]}</h2>
              {id === "surprise" ? (
                <Sparkles className="h-5 w-5 shrink-0 text-action" aria-hidden />
              ) : (
                <span className="shrink-0 rounded-full border border-line-strong px-2 py-0.5 text-xs text-ink-2">Individual</span>
              )}
            </div>
            <p className="mt-2 flex-1 text-ink-2">{SCENARIO_SUMMARIES[id]}</p>
            <Button
              variant="outline"
              className="mt-4 self-start"
              disabled={!ready}
              onClick={() => start(id)}
              aria-label={`Start: ${SCENARIOS[id]}`}
            >
              <Play className="h-4 w-4" aria-hidden />
              Start
            </Button>
          </li>
        ))}
      </ul>
      {hydrated && !ready && <p className="text-sm text-ink-3">Set up your household to start one of these.</p>}
    </main>
  );
}
