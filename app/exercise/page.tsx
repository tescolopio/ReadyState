"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type DeepPartial } from "ai";
import { AlertTriangle, ClipboardCheck, Home, Loader2, Play, RotateCcw, Send, ShieldCheck } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";

import previewJson from "@/data/fixtures/preview-exercise.json";
import { AlwaysMaskCard } from "@/components/always-mask";
import { SimulationLabel, Wordmark } from "@/components/brand";
import { DecisionPath } from "@/components/decision-path";
import { HouseholdWizard } from "@/components/household-wizard";
import { ProviderSettingsCard } from "@/components/provider-settings";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { AGE_RANGES, PET_KINDS, SCENARIOS, hasProfile, privateTerms, type HouseholdProfile } from "@/lib/household";
import { engineBaseline } from "@/lib/inventory";
import type { ServerConfig } from "@/lib/providers";
import { TEST_HOUSEHOLDS } from "@/lib/test-households";
import {
  TARGET_DURATION_HOURS,
  deriveTtxState,
  type AfterActionReport,
  type TtxUIMessage,
  type TurnFeedback,
  type TurnOutput,
} from "@/lib/ttx";
import { useHouseholdStore } from "@/store/useHouseholdStore";
import { usePrivacyStore } from "@/store/usePrivacyStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { maskInput, unmaskOutput } from "@/utils/obfuscator";

const DEBRIEF_REQUEST = "The exercise is over. Please prepare the debrief.";

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

export default function ExercisePage() {
  const [input, setInput] = useState("");
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const transport = useMemo(
    () =>
      new DefaultChatTransport<TtxUIMessage>({
        api: "/api/ttx",
        // Read at send time so saved Settings apply to the next request.
        body: () => ({ settings: useSettingsStore.getState().settings ?? undefined }),
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((config: ServerConfig | null) => {
        if (!cancelled) setServerConfig(config);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const { messages, sendMessage, setMessages, status, error, stop } = useChat<TtxUIMessage>({ transport });
  // Subscribe so unmasked output re-renders whenever the ledger changes.
  const entityMap = usePrivacyStore((state) => state.entityMap);
  const clearMappings = usePrivacyStore((state) => state.clearMappings);

  const ttx = useMemo(() => deriveTtxState(messages), [messages]);
  const busy = status === "submitted" || status === "streaming";
  const inputLocked = busy || ttx.phase === "ended" || ttx.phase === "aar";
  const complete = ttx.phase === "ended" || ttx.phase === "aar";

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const [wizardOpen, setWizardOpen] = useState(false);
  const household = useHouseholdStore((state) => state.profile);
  // The household profile lives in localStorage, which the server render can't see.
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  // `?sample=alex` opens a fictional sample household (design brief UX01).
  const sampleId = useQueryParam("sample");
  const sample = TEST_HOUSEHOLDS.find((h) => h.id === sampleId);
  // `?preview=1` loads a recorded exercise for design review, with no model calls.
  const preview = useQueryParam("preview") === "1";
  useEffect(() => {
    if (preview) setMessages(PREVIEW_MESSAGES);
  }, [preview, setMessages]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [activeProfile, setActiveProfile] = useState<HouseholdProfile | null>(null);

  // Sanitizes raw text before it reaches chat state / the API. The household's
  // names and medication names are always masked, even in typed responses.
  const maskFor = (profile: HouseholdProfile) => (text: string) =>
    maskInput(text, { alwaysMask: [...usePrivacyStore.getState().alwaysMask, ...privateTerms(profile)] });
  const submitText = (raw: string) => {
    const text = raw.trim();
    if (!text || inputLocked) return;
    setInput("");
    void sendMessage({ text: maskFor(activeProfile ?? household)(text) });
  };
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitText(input);
  };
  const startWithHousehold = (profile: HouseholdProfile) => {
    if (inputLocked) return;
    setWizardOpen(false);
    setActiveProfile(profile);
    // Only the household part is masked; the official guidance is public text.
    void sendMessage({ text: engineBaseline(profile, maskFor(profile)) });
  };
  // Guided responses fill the box rather than sending, so the participant can edit them.
  const chooseOption = (option: string) => {
    setInput(unmaskOutput(option));
    inputRef.current?.focus();
  };
  const options = ttx.phase === "loop" && !busy ? (ttx.latestTurn?.response_options ?? []) : [];

  const requestDebrief = () => {
    if (busy) return;
    void sendMessage({ text: DEBRIEF_REQUEST });
  };

  const resetExercise = () => {
    void stop();
    setMessages([]);
    clearMappings();
    setInput("");
    setActiveProfile(null);
  };

  const alerts = ttx.latestTurn?.critical_alerts ?? [];
  const shownProfile = activeProfile ?? (hydrated && hasProfile(household) ? household : null);

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Wordmark />
            <SimulationLabel />
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-ink-2">
              Exercise time{" "}
              <strong className="text-ink">{ttx.latestTurn?.time_elapsed ?? "not started"}</strong>
              <span className="text-ink-3"> of {TARGET_DURATION_HOURS} hours</span>
            </span>
            <Button variant="ghost" size="sm" onClick={resetExercise}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              Start over
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-label="Exercise" className="flex min-w-0 flex-col gap-5">
          <DecisionPath turns={ttx.turns} complete={complete} />

          {messages.length === 0 &&
            (wizardOpen ? (
              <HouseholdWizard onStart={startWithHousehold} onClose={() => setWizardOpen(false)} />
            ) : (
              <StartPanel
                sample={sample}
                savedProfile={hydrated && hasProfile(household)}
                locked={inputLocked}
                onSetup={() => setWizardOpen(true)}
                onStartSaved={() => startWithHousehold(household)}
                onStartSample={() => sample && startWithHousehold(structuredClone(sample.profile))}
              />
            ))}

          <div className="space-y-5">
            {messages.map((message) => (
              <MessageEntry key={message.id} message={message} />
            ))}
          </div>

          {busy && (
            <p className="flex items-center gap-2 text-sm text-ink-2" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              The exercise controller is preparing what happens next…
            </p>
          )}
          {error && (
            <p className="rounded-panel border border-error bg-error-soft p-4 text-sm text-error" role="alert">
              {errorText(error)}
            </p>
          )}

          {messages.length > 0 &&
            (ttx.phase === "ended" ? (
              <Button onClick={requestDebrief} disabled={busy} className="self-start">
                <ClipboardCheck className="h-4 w-4" aria-hidden />
                Debrief: what we learned
              </Button>
            ) : ttx.phase === "aar" ? null : (
              <form onSubmit={handleSubmit} className="space-y-3 rounded-panel border border-line bg-surface p-4 shadow-panel">
                <label htmlFor="response" className="block font-heading text-lg font-semibold">
                  {ttx.phase === "baseline" ? "Describe your household" : "What would you do next?"}
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
                  rows={4}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter adds a line; Ctrl/Cmd+Enter sends.
                    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault();
                      submitText(input);
                    }
                  }}
                  disabled={inputLocked}
                  placeholder="Explain your plan in your own words…"
                  className="block w-full resize-y rounded-control border border-line-strong bg-field px-3 py-2.5 text-base text-ink placeholder:text-ink-3 disabled:opacity-60"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-ink-3">Ctrl+Enter to submit. Names and places are masked before sending.</span>
                  <Button type="submit" disabled={inputLocked || !input.trim()}>
                    <Send className="h-4 w-4" aria-hidden />
                    Submit response
                  </Button>
                </div>
              </form>
            ))}
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

          <Panel title="Household" icon={<Home className="h-4 w-4 text-action" aria-hidden />}>
            <HouseholdSummary profile={shownProfile} />
            {messages.length === 0 && (
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setWizardOpen(true)}>
                {shownProfile ? "Edit household" : "Set up household"}
              </Button>
            )}
          </Panel>

          <details className="rounded-panel border border-line bg-surface shadow-panel">
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
              Privacy: what stays on this device
            </summary>
            <div className="space-y-3 px-4 pb-4">
              <p className="text-sm text-ink-2">Only these tags are sent; the real values never leave your browser.</p>
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
              <AlwaysMaskCard />
            </div>
          </details>

          {serverConfig?.mode === "self-hosted" && (
            <details className="rounded-panel border border-line bg-surface shadow-panel">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Model provider</summary>
              <div className="px-4 pb-4">
                <ProviderSettingsCard config={serverConfig} />
              </div>
            </details>
          )}
        </aside>
      </main>
      <SiteFooter />
    </div>
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
        <p className="text-sm font-semibold text-attention">Sample exercise</p>
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
        Names, places, addresses and contact details are replaced with tags like [Person 1] before anything leaves your browser.
      </p>
    </section>
  );
}

function HouseholdSummary({ profile }: { profile: HouseholdProfile | null }) {
  if (!profile) return <p className="text-sm text-ink-3">No household yet.</p>;
  const ages = profile.people.map((person) => (person.ageRange ? AGE_RANGES[person.ageRange] : "person"));
  const pets = profile.pets.map((pet) => [pet.size, PET_KINDS[pet.kind]].filter(Boolean).join(" "));
  return (
    <dl className="space-y-1 text-sm">
      <div className="flex justify-between gap-2">
        <dt className="text-ink-3">People</dt>
        <dd className="text-right">{ages.length ? ages.join(", ") : "not set"}</dd>
      </div>
      {pets.length > 0 && (
        <div className="flex justify-between gap-2">
          <dt className="text-ink-3">Pets</dt>
          <dd className="text-right">{pets.join(", ")}</dd>
        </div>
      )}
      <div className="flex justify-between gap-2">
        <dt className="text-ink-3">Emergency</dt>
        <dd className="text-right">{SCENARIOS[profile.scenario]}</dd>
      </div>
    </dl>
  );
}

function MessageEntry({ message }: { message: TtxUIMessage }) {
  if (message.role === "user") {
    const text = message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
    // The household baseline is long and structured; show it compactly.
    const isBaseline = text.startsWith("People:") || text.includes("\nOfficial guidance");
    return (
      <article className="ml-auto max-w-[90%] rounded-panel border border-line bg-action-soft px-4 py-3">
        <p className="mb-1 text-xs font-semibold text-ink-2">{isBaseline ? "Household sent (masked)" : "Your response · submitted"}</p>
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
              <TurnView key={index} turn={part.input} />
            );
          case "tool-after_action_report":
            return part.state === "output-error" ? (
              <p key={index} className="text-sm text-error">{part.errorText}</p>
            ) : (
              <DebriefView key={index} report={part.input} />
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

function TurnView({ turn }: { turn?: DeepPartial<TurnOutput> }) {
  if (!turn) return null;
  return (
    <div className="space-y-4">
      <FeedbackView feedback={turn.feedback} />
      <ItemList title="Next steps for your real plan" items={turn.suggested_actions} />
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

function DebriefView({ report }: { report?: DeepPartial<AfterActionReport> }) {
  if (!report) return null;
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Debrief</h2>
      {report.summary && <p className="leading-relaxed">{unmaskOutput(report.summary)}</p>}
      <ItemList title="What you need to know" items={report.need_to_know} />
      <ItemList title="What you can do better" items={report.do_better} />
      <ItemList title="What went well" items={report.went_well} />
      <p className="text-sm text-ink-3">Completing an exercise is practice, not proof of real-world readiness.</p>
    </div>
  );
}
