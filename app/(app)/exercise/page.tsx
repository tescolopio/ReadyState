"use client";

import { useChat } from "@ai-sdk/react";
import type { DeepPartial } from "ai";
import { AlertTriangle, Check, ClipboardCheck, Home, Loader2, Pause, Play, Plus, RotateCcw, Send, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";

import previewJson from "@/data/fixtures/preview-exercise.json";
import { AlwaysMaskCard } from "@/components/always-mask";
import { SimulationLabel } from "@/components/brand";
import { DecisionPath } from "@/components/decision-path";
import { HouseholdSummary } from "@/components/household-summary";
import { HouseholdWizard } from "@/components/household-wizard";
import { OutgoingReviewPanel } from "@/components/outgoing-review";
import { Button } from "@/components/ui/button";
import { exerciseChat, resendLast, resetExercise, sendToExercise, useExerciseSession } from "@/lib/exercise-session";
import { SCENARIOS, hasProfile, privateTerms, type HouseholdProfile } from "@/lib/household";
import { engineBaseline } from "@/lib/inventory";
import { createApprover, editReview, prepareReview, type OutgoingReview } from "@/lib/outgoing-review";
import { TEST_HOUSEHOLDS } from "@/lib/test-households";
import {
  DEBRIEF_REQUEST,
  OMITTED_IMPROVEMENT_NOTICE,
  TARGET_DURATION_HOURS,
  deriveTtxState,
  type AfterActionReport,
  type Improvement,
  type TtxUIMessage,
  type TurnFeedback,
  type TurnOutput,
} from "@/lib/ttx";
import { useHouseholdStore } from "@/store/useHouseholdStore";
import { usePlanStore } from "@/store/usePlanStore";
import { usePrivacyStore } from "@/store/usePrivacyStore";
import { unmaskOutput } from "@/utils/obfuscator";


/** Three recorded, already-masked turns from an eval run of the "sam" test household. */
const PREVIEW_MESSAGES = previewJson as unknown as TtxUIMessage[];

/** API errors arrive as the raw response body, usually `{ "error": "..." }`. */
const errorText = (error: Error) => {
  try {
    const parsed = JSON.parse(error.message);
    if (typeof parsed?.error === "string") return parsed.error;
  } catch {}
  return error.message;
};

const noSubscribe = () => () => {};
const useQueryParam = (name: string) =>
  useSyncExternalStore(
    noSubscribe,
    () => new URLSearchParams(window.location.search).get(name),
    () => null,
  );

/** How lessons are labeled in the action plan: "Hour 6 · Winter storm". */
interface LessonSource {
  scenario: string;
  /** Lessons from a fictional sample can't be kept in your own plan. */
  keepable: boolean;
}

export default function ExercisePage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  // The exercise lives outside this page, so leaving for Journal or Settings doesn't end it.
  const { messages, setMessages, status, error } = useChat<TtxUIMessage>({ chat: exerciseChat });
  // Subscribe so unmasked output re-renders whenever the ledger changes.
  const entityMap = usePrivacyStore((state) => state.entityMap);
  const alwaysMaskList = usePrivacyStore((state) => state.alwaysMask);
  const { activeProfile, sampleId: activeSampleId } = useExerciseSession();

  const ttx = deriveTtxState(messages);
  const busy = status === "submitted" || status === "streaming";
  // Read from the chat itself, so two clicks in one frame see the first one's request.
  const exerciseBusy = () => exerciseChat.status === "submitted" || exerciseChat.status === "streaming";
  const inputLocked = busy || ttx.phase === "ended" || ttx.phase === "aar";
  const complete = ttx.phase === "ended" || ttx.phase === "aar";

  const [wizardOpen, setWizardOpen] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const household = useHouseholdStore((state) => state.profile);
  // The household profile lives in localStorage, which the server render can't see.
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  // `?sample=alex` opens a fictional sample household (design brief UX01).
  const sampleParam = useQueryParam("sample");
  const sample = TEST_HOUSEHOLDS.find((h) => h.id === sampleParam);
  // `?preview=1` loads a recorded exercise for design review, with no model calls.
  const preview = useQueryParam("preview") === "1";
  // `?start=1` starts straight away with the saved household, from Exercises or My household.
  const autoStart = useQueryParam("start") === "1";
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Every message is reviewed before it leaves the browser (work item S2):
  // masked into a review, and sent only when the participant chooses Send.
  const [review, setReview] = useState<OutgoingReview | null>(null);
  const [reviewNotice, setReviewNotice] = useState<string>();
  const [reviewBlocked, setReviewBlocked] = useState<string[]>();

  // The household's names and medication names are always masked, even in typed responses.
  const alwaysMask = (profile?: HouseholdProfile) => [
    ...usePrivacyStore.getState().alwaysMask,
    ...privateTerms(profile ?? useExerciseSession.getState().activeProfile ?? useHouseholdStore.getState().profile),
  ];
  const ledger = () => usePrivacyStore.getState().entityMap;
  const [approve] = useState(() =>
    createApprover({
      ledger,
      addMapping: (value, tag) => usePrivacyStore.getState().addMapping(value, tag),
      alwaysMask: (review) => alwaysMask(review.start?.profile),
      send: (text, { start }) => {
        // A baseline starts the exercise only now, once it's sent.
        if (start) useExerciseSession.getState().begin(start.profile, start.sampleId);
        else setInput("");
        void sendToExercise(text);
      },
    }),
  );

  const openReview = (next: OutgoingReview, notice?: string) => {
    setReview(next);
    setReviewNotice(notice);
    setReviewBlocked(undefined);
  };
  const submitText = (raw: string) => {
    const text = raw.trim();
    if (!text || inputLocked || review) return;
    openReview(prepareReview("response", (mask) => mask(text), ledger(), alwaysMask()));
  };
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitText(input);
  };
  const reviewBaseline = (profile: HouseholdProfile, sampleId?: string) => {
    // Only the household part is masked; the official guidance is public text.
    openReview(prepareReview("baseline", (mask) => engineBaseline(profile, mask), ledger(), alwaysMask(profile), { profile, sampleId }));
  };
  const startWithHousehold = (profile: HouseholdProfile, sampleId?: string) => {
    if (inputLocked || review) return;
    setWizardOpen(false);
    reviewBaseline(profile, sampleId);
  };
  const sendReview = () => {
    if (!review || exerciseBusy()) return;
    const result = approve(review);
    if (result.status === "sent" || result.status === "duplicate") setReview(null);
    else if (result.status === "blocked") setReviewBlocked(result.problems);
    else openReview(result.review, result.reason);
  };
  const maskAndRebuild = (value: string) => {
    if (!review) return;
    const store = usePrivacyStore.getState();
    store.setAlwaysMask([...store.alwaysMask, value]);
    openReview(prepareReview(review.kind, review.build, ledger(), alwaysMask(review.start?.profile), review.start), `"${value}" is now masked everywhere. Review the rebuilt message.`);
  };
  const leaveReview = () => {
    const kind = review?.kind;
    setReview(null);
    // Back to the typed response, which is kept as it was.
    if (kind === "response") setTimeout(() => inputRef.current?.focus());
  };
  // A failed request is sent again exactly as approved, with the same Settings.
  const retry = () => {
    if (exerciseBusy()) return;
    void resendLast();
  };

  useEffect(() => {
    if (preview && exerciseChat.messages.length === 0) setMessages(PREVIEW_MESSAGES);
  }, [preview, setMessages]);

  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStarted.current || !hydrated || exerciseChat.messages.length > 0) return;
    autoStarted.current = true;
    router.replace("/exercise");
    // After this effect, like a click: the review is state, not a side effect of rendering.
    if (hasProfile(household)) setTimeout(() => reviewBaseline(household));
    // Runs once, when the saved household is readable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, hydrated]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  // Guided responses fill the box rather than sending, so the participant can edit them.
  const chooseOption = (option: string) => {
    setInput(unmaskOutput(option));
    inputRef.current?.focus();
  };
  const options = ttx.phase === "loop" && !busy ? (ttx.latestTurn?.response_options ?? []) : [];

  const requestDebrief = () => {
    if (exerciseBusy()) return;
    void sendToExercise(DEBRIEF_REQUEST);
  };
  const startOver = () => {
    resetExercise();
    setReview(null);
    setInput("");
    setConfirmingReset(false);
  };

  const alerts = ttx.latestTurn?.critical_alerts ?? [];
  const shownProfile = activeProfile ?? review?.start?.profile ?? (hydrated && hasProfile(household) ? household : null);
  const scenario = activeProfile && activeProfile.scenario !== "surprise" ? SCENARIOS[activeProfile.scenario] : "Exercise";
  const source: LessonSource = { scenario, keepable: !activeSampleId && !preview };

  // The current moment leads: the latest response, its feedback and what's happening now.
  // Everything before it folds away, still one click from view (Modern treatment §7.5).
  const lastUser = messages.findLastIndex((message) => message.role === "user");
  const earlier = lastUser > 0 ? messages.slice(0, lastUser) : [];
  const current = lastUser >= 0 ? messages.slice(lastUser) : messages;
  const decisions = earlier.filter((message) => message.role === "user").length;

  const reviewPanel = review && (
    <OutgoingReviewPanel
      review={review}
      notice={reviewNotice}
      blocked={reviewBlocked}
      sending={busy}
      onEdit={(text) => {
        setReview(editReview(review, text));
        setReviewBlocked(undefined);
      }}
      onMask={maskAndRebuild}
      onSend={sendReview}
      onBack={leaveReview}
    />
  );

  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section aria-label="Exercise" className="flex min-w-0 flex-col gap-5">
        {messages.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <SimulationLabel />
                <h1 className="text-xl font-semibold">{scenario}</h1>
                {activeSampleId && <span className="text-sm text-ink-3">· Sample, fictional household</span>}
              </div>
              <p className="text-sm text-ink-2">
                Exercise time <strong className="text-ink">{ttx.latestTurn?.time_elapsed ?? "starting"}</strong>
                <span className="text-ink-3"> of {TARGET_DURATION_HOURS} hours</span>
              </p>
            </div>
            <DecisionPath turns={ttx.turns} complete={complete} />
          </div>
        )}

        {review?.kind === "baseline" && reviewPanel}

        {messages.length === 0 &&
          !review &&
          (wizardOpen ? (
            <HouseholdWizard onStart={(profile) => startWithHousehold(profile)} onClose={() => setWizardOpen(false)} />
          ) : (
            <StartPanel
              sample={sample}
              savedProfile={hydrated && hasProfile(household)}
              locked={inputLocked}
              onSetup={() => setWizardOpen(true)}
              onStartSaved={() => startWithHousehold(household)}
              onStartSample={() => sample && startWithHousehold(structuredClone(sample.profile), sample.id)}
            />
          ))}

        {earlier.length > 0 && (
          <details className="rounded-panel border border-line bg-surface">
            <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-semibold text-ink-2">
              Earlier in this exercise: {decisions === 0 ? "your household" : `${decisions} ${decisions === 1 ? "decision" : "decisions"}`}
            </summary>
            <div className="space-y-4 border-t border-line p-4">
              {earlier.map((message) => (
                <MessageEntry key={message.id} message={message} source={source} />
              ))}
            </div>
          </details>
        )}

        <div className="space-y-5">
          {current.map((message) => (
            <MessageEntry key={message.id} message={message} source={source} />
          ))}
        </div>

        {busy && (
          <p className="flex items-center gap-2 text-sm text-ink-2" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {lastUser === 0 ? "Setting the scene for your household…" : "Reading your response and preparing what happens next…"}
          </p>
        )}
        {error && (
          <div className="space-y-2 rounded-panel border border-error bg-error-soft p-4 text-sm text-error" role="alert">
            <p>{errorText(error)}</p>
            {ttx.phase === "ended" ? (
              <p className="text-ink-2">Your exercise is still here. Use the debrief button below to ask again.</p>
            ) : (
              <p className="text-ink-2">
                Your exercise so far is still here. Check the model provider in{" "}
                <Link href="/settings" className="font-semibold text-ink underline underline-offset-2">
                  Settings
                </Link>
                , or send the same message again.
              </p>
            )}
            {ttx.phase !== "ended" && (
              <Button size="sm" variant="outline" onClick={retry} disabled={busy}>
                <RotateCcw className="h-4 w-4" aria-hidden />
                Send the same message again
              </Button>
            )}
          </div>
        )}

        {messages.length > 0 && ttx.phase === "ended" && (
          <div className="space-y-2">
            <p id="debrief-disclosure" className="text-sm text-ink-2">
              This sends the existing exercise history, including your reviewed messages and model-generated events,
              to ReadyState&apos;s server for another model call with the selected provider.
            </p>
            <Button onClick={requestDebrief} disabled={busy} aria-describedby="debrief-disclosure">
              <ClipboardCheck className="h-4 w-4" aria-hidden />
              Debrief: what we learned
            </Button>
          </div>
        )}
        {ttx.phase === "aar" && !busy && (activeSampleId ? <MakeThisMine router={router} /> : <WhatNext router={router} />)}

        {review?.kind === "response" && reviewPanel}

        {ttx.turns.length > 0 && !complete && !review && (
          <form onSubmit={handleSubmit} className="space-y-3 rounded-panel border border-line bg-surface p-4 shadow-panel">
            <label htmlFor="response" className="block font-heading text-lg font-semibold">
              What would you do next?
            </label>
            {options.length > 0 && (
              <fieldset>
                <legend className="mb-2 text-sm text-ink-2">Start from one of these, or write your own:</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {options.map((option, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => chooseOption(option)}
                      className="rounded-control border border-line-strong bg-field px-3 py-2.5 text-left text-sm text-ink hover:border-action hover:bg-action-soft"
                    >
                      {unmaskOutput(option)}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            <textarea
              id="response"
              ref={inputRef}
              value={input}
              rows={5}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                // Enter adds a line; Ctrl/Cmd+Enter sends.
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  submitText(input);
                }
              }}
              disabled={inputLocked}
              aria-describedby="response-hint"
              placeholder="Explain your plan in your own words…"
              className="block w-full resize-y rounded-control border border-line-strong bg-field px-3 py-2.5 text-base text-ink placeholder:text-ink-3 disabled:opacity-60"
            />
            <p id="response-hint" className="text-xs text-ink-3">
              Ctrl+Enter to review it. You&apos;ll see exactly what&apos;s sent, with names and places masked, before it goes.
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                href="/journal"
                className="inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold text-ink-2 hover:bg-action-soft hover:text-ink"
              >
                <Pause className="h-4 w-4" aria-hidden />
                Pause and leave
              </Link>
              <Button type="submit" disabled={inputLocked || !input.trim()}>
                <Send className="h-4 w-4" aria-hidden />
                Review before sending
              </Button>
            </div>
            <p className="text-xs text-ink-3">Paused exercises wait in this tab until you close it or reload.</p>
          </form>
        )}
        <div ref={bottomRef} />
      </section>

      <aside aria-label="Context" className="flex flex-col gap-4">
        <Panel title="Needs attention" icon={<AlertTriangle className="h-4 w-4 text-attention" aria-hidden />}>
          {alerts.length === 0 ? (
            <p className="text-sm text-ink-3">Nothing right now.</p>
          ) : (
            // Steady, not pulsing: exercise events shouldn't look like live alarms.
            <ul className="space-y-2">
              {alerts.map((alert, index) => (
                <li key={index} className="rounded-control border-l-4 border-attention-accent bg-attention-soft px-3 py-2 text-sm text-ink">
                  {unmaskOutput(alert)}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={activeSampleId ? "Household (fictional sample)" : "Household"} icon={<Home className="h-4 w-4 text-action" aria-hidden />}>
          <HouseholdSummary profile={shownProfile} />
          {messages.length === 0 && (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setWizardOpen(true)}>
              {shownProfile ? "Edit household" : "Set up household"}
            </Button>
          )}
        </Panel>

        <details className="rounded-panel border border-line bg-surface shadow-panel">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
            Privacy: what stays on this device
          </summary>
          <div className="space-y-3 px-4 pb-4">
            <p className="text-sm text-ink-2">
              These values were sent as their tags. Masking catches your household&apos;s names and common patterns such as
              addresses and phone numbers; it can miss other details you type.
            </p>
            {Object.keys(entityMap).length === 0 ? (
              <p className="text-sm text-ink-3">Nothing masked yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {Object.entries(entityMap).map(([tag, real]) => (
                  <li key={tag} className="flex justify-between gap-2">
                    <span className="font-medium text-success">{tag}</span>
                    <span className="truncate text-ink-2">{real}</span>
                  </li>
                ))}
              </ul>
            )}
            {/* Keyed by the list, so a word masked from a review shows up in the card. */}
            <AlwaysMaskCard key={alwaysMaskList.join("\0")} />
          </div>
        </details>

        {messages.length > 0 &&
          (confirmingReset ? (
            <div role="group" aria-label="Confirm starting over" className="space-y-2 rounded-panel border border-line-strong bg-surface p-4 text-sm">
              <p>Start over? This ends the exercise; anything you kept in your action plan stays.</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={startOver}>
                  End this exercise
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmingReset(false)} autoFocus>
                  Keep going
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setConfirmingReset(true)}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              Start over
            </Button>
          ))}
      </aside>
    </main>
  );
}

type Router = ReturnType<typeof useRouter>;

/** The sample's ending (design brief §3): offered once the value is visible, never before. */
function MakeThisMine({ router }: { router: Router }) {
  return (
    <section className="space-y-3 rounded-panel border border-action bg-action-soft p-5">
      <h2 className="text-xl font-semibold">Make this mine</h2>
      <p className="max-w-prose text-ink-2">
        That household was fictional. Set up your own, as briefly as you like, and practice with the people, pets and home
        you actually have. Nothing from the sample is saved.
      </p>
      <Button
        onClick={() => {
          resetExercise();
          router.push("/household?setup=1");
        }}
      >
        <Home className="h-4 w-4" aria-hidden />
        Set up my household
      </Button>
    </section>
  );
}

function WhatNext({ router }: { router: Router }) {
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-panel border border-line bg-surface p-5">
      <p className="mr-auto font-semibold">What next?</p>
      <Link
        href="/plan"
        className="inline-flex min-h-11 items-center rounded-control bg-action px-4 text-sm font-semibold text-on-action hover:bg-action-hover"
      >
        Review my action plan
      </Link>
      <Button
        variant="outline"
        onClick={() => {
          resetExercise();
          router.push("/exercises");
        }}
      >
        Start another exercise
      </Button>
    </section>
  );
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-panel border border-line bg-surface p-4 shadow-panel">
      <h2 className="mb-3 flex items-center gap-2 font-sans text-sm font-semibold">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function StartPanel({
  sample,
  savedProfile,
  locked,
  onSetup,
  onStartSaved,
  onStartSample,
}: {
  sample?: (typeof TEST_HOUSEHOLDS)[number];
  savedProfile: boolean;
  locked: boolean;
  onSetup: () => void;
  onStartSaved: () => void;
  onStartSample: () => void;
}) {
  if (sample) {
    return (
      <section className="space-y-4 rounded-panel border border-line bg-surface p-6 shadow-panel">
        <div className="flex items-center gap-2">
          <SimulationLabel />
          <p className="text-sm font-semibold text-attention">Sample exercise</p>
        </div>
        <h1 className="text-2xl font-semibold">{sample.persona}</h1>
        <p className="text-ink-2">{sample.tests}</p>
        <p className="text-sm text-ink-3">
          This household is fictional and nothing is saved. You&apos;ll read each situation, write what you&apos;d do, and see feedback.
        </p>
        <Button onClick={onStartSample} disabled={locked}>
          <Play className="h-4 w-4" aria-hidden />
          Start the sample
        </Button>
      </section>
    );
  }
  return (
    <section className="space-y-4 rounded-panel border border-line bg-surface p-6 shadow-panel">
      <h1 className="text-2xl font-semibold">Practice an emergency, step by step</h1>
      <p className="max-w-prose text-ink-2">
        Tell ReadyState about your household, as briefly or in as much detail as you like. You&apos;ll get a developing
        situation, decide what to do, and see what you covered, what to consider and why it matters.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onSetup}>
          <Home className="h-4 w-4" aria-hidden />
          {savedProfile ? "Review my household" : "Set up my household"}
        </Button>
        {savedProfile && (
          <Button variant="outline" onClick={onStartSaved} disabled={locked}>
            <Play className="h-4 w-4" aria-hidden />
            Start with my saved household
          </Button>
        )}
      </div>
      <p className="text-sm text-ink-3">
        Names, medication and device names, places, addresses and contact details are replaced with tags like [Person 1], and
        you review exactly what&apos;s sent before it leaves your browser.
      </p>
    </section>
  );
}

function MessageEntry({ message, source }: { message: TtxUIMessage; source: LessonSource }) {
  if (message.role === "user") {
    const text = message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
    // The household baseline is long and structured; show it compactly.
    const isBaseline = text.startsWith("People:") || text.includes("\nOfficial guidance");
    if (text === DEBRIEF_REQUEST) return null;
    return (
      <article className="rounded-panel border border-line bg-action-soft px-4 py-3">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink-2">
          {isBaseline ? (
            "Household sent (masked)"
          ) : (
            <>
              <Check className="h-3.5 w-3.5" aria-hidden />
              Your response · submitted
            </>
          )}
        </p>
        {isBaseline ? (
          <details>
            <summary className="cursor-pointer text-sm text-ink-2">Show what the scenario engine received</summary>
            <p className="mt-2 whitespace-pre-wrap text-sm">{unmaskOutput(text)}</p>
          </details>
        ) : (
          <p className="whitespace-pre-wrap">{unmaskOutput(text)}</p>
        )}
      </article>
    );
  }

  return (
    <article className="space-y-4 rounded-panel border border-line bg-surface p-5 shadow-panel">
      {message.parts.map((part, index) => {
        switch (part.type) {
          case "text":
            return part.text.trim() ? (
              <p key={index} className="whitespace-pre-wrap">
                {unmaskOutput(part.text)}
              </p>
            ) : null;
          case "tool-generate_turn":
            return part.state === "output-error" ? (
              <p key={index} className="text-sm text-error">{part.errorText}</p>
            ) : (
              <TurnView key={index} turn={part.input} source={source} ready={part.state !== "input-streaming"} />
            );
          case "tool-after_action_report":
            return part.state === "output-error" ? (
              <p key={index} className="text-sm text-error">{part.errorText}</p>
            ) : (
              <DebriefView
                key={index}
                report={part.input}
                source={source}
                ready={part.state !== "input-streaming"}
                omitted={Boolean(message.metadata?.debriefChecks?.omittedImprovement)}
              />
            );
          default:
            return null;
        }
      })}
    </article>
  );
}

/** A labeled list that renders nothing until the model has streamed an item. */
function ItemList({ title, items }: { title: string; items?: (string | undefined)[] }) {
  const present = items?.filter((item): item is string => Boolean(item));
  if (!present?.length) return null;
  return (
    <div>
      <h3 className="font-sans text-sm font-semibold">{title}</h3>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {present.map((item, index) => (
          <li key={index}>{unmaskOutput(item)}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Practical steps the participant can keep in their action plan (design brief
 * §5 "Action item"). Nothing is added unless they choose it.
 */
function KeepableList({
  title,
  items,
  label,
  source,
  ready,
}: {
  title: string;
  /** Steps, or debrief improvements whose action is the step and whose reason and evidence are shown beneath it. */
  items?: (string | DeepPartial<Improvement> | undefined)[];
  label: string;
  source: LessonSource;
  ready: boolean;
}) {
  const plan = usePlanStore((state) => state.items);
  const add = usePlanStore((state) => state.add);
  const present = items
    ?.map((item) => (typeof item === "string" ? { action: item } : item))
    .filter((item): item is DeepPartial<Improvement> & { action: string } => Boolean(item?.action));
  if (!present?.length) return null;
  return (
    <div>
      <h3 className="font-sans text-sm font-semibold">{title}</h3>
      <ul className="mt-2 space-y-2">
        {present.map((item, index) => {
          const text = unmaskOutput(item.action);
          const kept = plan.some((planned) => planned.text === text);
          return (
            <li key={index} className="flex flex-wrap items-start justify-between gap-2 rounded-control border border-line px-3 py-2">
              <div className="min-w-0 flex-1 basis-60">
                <p>{text}</p>
                {item.why && <p className="mt-1 text-sm text-ink-2">{unmaskOutput(item.why)}</p>}
                {item.evidence && <p className="mt-1 text-xs text-ink-3">From {unmaskOutput(item.evidence)}</p>}
              </div>
              {ready && source.keepable &&
                (kept ? (
                  <span className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-success">
                    <Check className="h-4 w-4" aria-hidden />
                    In your plan
                  </span>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => add({ text, source: label })}>
                    <Plus className="h-4 w-4" aria-hidden />
                    Keep in my plan
                  </Button>
                ))}
            </li>
          );
        })}
      </ul>
      {ready && !source.keepable && (
        <p className="mt-2 text-xs text-ink-3">Steps from a sample or preview aren&apos;t added to your plan.</p>
      )}
    </div>
  );
}

/** Feedback on the participant's response, in the design brief's three parts. */
function FeedbackView({ feedback }: { feedback?: DeepPartial<TurnFeedback> | null }) {
  if (!feedback) return null;
  return (
    <section aria-label="Feedback on your response" className="space-y-3 rounded-control border border-line bg-success-soft p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-success">Feedback on your response</p>
      <ItemList title="What you covered" items={feedback.covered} />
      <ItemList title="What to consider" items={feedback.consider} />
      {feedback.why && (
        <div>
          <h3 className="font-sans text-sm font-semibold">Why it matters</h3>
          <p className="mt-1">{unmaskOutput(feedback.why)}</p>
        </div>
      )}
    </section>
  );
}

function TurnView({ turn, source, ready }: { turn?: DeepPartial<TurnOutput>; source: LessonSource; ready: boolean }) {
  if (!turn) return null;
  return (
    <div className="space-y-4">
      <FeedbackView feedback={turn.feedback} />
      <KeepableList
        title="Next steps for your real plan"
        items={turn.suggested_actions}
        label={`${turn.time_elapsed ?? "Exercise"} · ${source.scenario}`}
        source={source}
        ready={ready}
      />
      {/* What happens next, set apart from feedback on the previous response. */}
      <div className={`space-y-3 ${turn.feedback ? "border-t border-line pt-4" : ""}`}>
        {turn.time_elapsed && (
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-3">{turn.time_elapsed} · Simulation</p>
        )}
        {turn.narrative_response && <p className="whitespace-pre-wrap leading-relaxed">{unmaskOutput(turn.narrative_response)}</p>}
        {turn.new_inject && (
          <div className="rounded-control border-l-4 border-attention-accent bg-attention-soft p-4">
            <h3 className="font-sans text-sm font-semibold text-attention">What&apos;s happening now</h3>
            <p className="mt-1 whitespace-pre-wrap">{unmaskOutput(turn.new_inject)}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DebriefView({
  report,
  source,
  ready,
  omitted,
}: {
  report?: DeepPartial<AfterActionReport>;
  source: LessonSource;
  ready: boolean;
  /** The server dropped an improvement that failed its checks (lib/debrief-checks.ts, omitKitImprovement). */
  omitted: boolean;
}) {
  if (!report) return null;
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Debrief</h2>
      {report.summary && <p className="leading-relaxed">{unmaskOutput(report.summary)}</p>}
      <ItemList title="What you need to know" items={report.need_to_know} />
      <KeepableList
        title="What you can do better"
        items={report.do_better}
        label={`Debrief · ${source.scenario}`}
        source={source}
        ready={ready}
      />
      {omitted && <p className="text-sm text-ink-3">{OMITTED_IMPROVEMENT_NOTICE}</p>}
      <ItemList title="What went well" items={report.went_well} />
      {report.supply_checklist?.some(Boolean) && (
        <details className="rounded-control border border-line p-3">
          <summary className="cursor-pointer text-sm font-semibold">Fuller supply checklist (optional)</summary>
          <div className="mt-2">
            <ItemList title="Worth gathering over time" items={report.supply_checklist} />
          </div>
        </details>
      )}
      <p className="text-sm text-ink-3">Completing an exercise is practice, not proof of real-world readiness.</p>
    </div>
  );
}
