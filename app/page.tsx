"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type DeepPartial } from "ai";
import {
  Activity,
  AlertTriangle,
  ClipboardCheck,
  Clock,
  Loader2,
  RotateCcw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { ProviderSettingsCard } from "@/components/provider-settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  TARGET_DURATION_HOURS,
  deriveTtxState,
  type AfterActionReport,
  type TtxPhase,
  type TtxUIMessage,
  type TurnOutput,
} from "@/lib/ttx";
import type { ServerConfig } from "@/lib/providers";
import { usePrivacyStore } from "@/store/usePrivacyStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { maskInput, unmaskOutput } from "@/utils/obfuscator";

const PHASE_LABELS: Record<TtxPhase, string> = {
  baseline: "PHASE 1 // BASELINE",
  loop: "PHASE 2 // ACTION & INJECT",
  ended: "PHASE 3 // END CONDITION",
  aar: "PHASE 4 // AFTER-ACTION REPORT",
};

const PLACEHOLDERS: Record<TtxPhase, string> = {
  baseline:
    "Describe your household: e.g. 2 adults, a large dog, insulin that requires refrigeration, winter storm in Denver…",
  loop: "Declare your next action…",
  ended: "Exercise complete — generate the After-Action Report.",
  aar: "Exercise complete — reset to run a new scenario.",
};

const AAR_REQUEST = "Exercise ended. Generate the After-Action Report.";

/** API errors arrive as the raw response body, usually `{ "error": "..." }`. */
const errorText = (error: Error) => {
  try {
    const parsed = JSON.parse(error.message);
    if (typeof parsed?.error === "string") return parsed.error;
  } catch {}
  return error.message;
};

export default function TtxDashboard() {
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
  const { messages, sendMessage, setMessages, status, error, stop } =
    useChat<TtxUIMessage>({ transport });
  // Subscribe so unmasked output re-renders whenever the ledger changes.
  const entityMap = usePrivacyStore((state) => state.entityMap);
  const clearMappings = usePrivacyStore((state) => state.clearMappings);

  const ttx = useMemo(() => deriveTtxState(messages), [messages]);
  const busy = status === "submitted" || status === "streaming";
  const inputLocked = busy || ttx.phase === "ended" || ttx.phase === "aar";

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Wraps submission so raw text is sanitized before it reaches chat state / the API.
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const raw = input.trim();
    if (!raw || inputLocked) return;
    setInput("");
    void sendMessage({ text: maskInput(raw) });
  };

  const requestAfterActionReport = () => {
    if (busy) return;
    void sendMessage({ text: AAR_REQUEST });
  };

  const resetExercise = () => {
    void stop();
    setMessages([]);
    clearMappings();
    setInput("");
  };

  const progress = Math.min(
    100,
    Math.round((ttx.hoursElapsed / TARGET_DURATION_HOURS) * 100),
  );
  const alerts = ttx.latestTurn?.critical_alerts ?? [];

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 bg-zinc-900/80 px-6 py-3">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-emerald-400" aria-hidden />
          <h1 className="font-mono text-sm font-semibold tracking-widest">
            READYSTATE{" "}
            <span className="text-zinc-500">{"// TTX CONTROL PLANE"}</span>
          </h1>
          <Badge variant="outline" className="font-mono">
            {PHASE_LABELS[ttx.phase]}
          </Badge>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 font-mono text-sm">
            <Clock className="h-4 w-4 text-zinc-400" aria-hidden />
            <span>{ttx.latestTurn?.time_elapsed ?? "Hour 0"}</span>
            <span className="text-zinc-500">/ T+{TARGET_DURATION_HOURS}h</span>
          </div>
          <Button variant="outline" size="sm" onClick={resetExercise}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Reset
          </Button>
        </div>
      </header>
      <div className="h-1 w-full bg-zinc-900">
        <div
          className="h-full bg-emerald-500 transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      <main className="grid flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_320px]">
        <Card className="flex min-h-0 flex-col">
          <CardHeader className="border-b border-zinc-800">
            <CardTitle className="font-mono text-xs uppercase tracking-widest text-zinc-400">
              Simulation Terminal
            </CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            <ScrollArea className="h-[60vh] flex-1 px-4 py-4 lg:h-[calc(100vh-15rem)]">
              {messages.length === 0 && (
                <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-sm text-zinc-400">
                  <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">
                    Awaiting baseline parameters
                  </p>
                  <p className="mt-2">
                    Describe your household, supplies, and constraints. Names
                    and places are replaced with tags like{" "}
                    <code className="text-zinc-200">[Person 1]</code> before
                    anything leaves your browser.
                  </p>
                </div>
              )}
              <div className="space-y-4">
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
              </div>
              {busy && (
                <div className="mt-4 flex items-center gap-2 font-mono text-xs text-zinc-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  CONTROLLER PROCESSING…
                </div>
              )}
              {error && (
                <div className="mt-4 rounded-md border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
                  Transmission failed: {errorText(error)}
                </div>
              )}
              <div ref={bottomRef} />
            </ScrollArea>

            <div className="border-t border-zinc-800 p-4">
              {ttx.phase === "ended" ? (
                <Button
                  className="w-full"
                  onClick={requestAfterActionReport}
                  disabled={busy}
                >
                  <ClipboardCheck className="h-4 w-4" aria-hidden />
                  Generate After-Action Report (
                  {ttx.outcome === "failed" ? "Failed" : "Survived"})
                </Button>
              ) : (
                <form onSubmit={handleSubmit} className="flex gap-2">
                  <Input
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder={PLACEHOLDERS[ttx.phase]}
                    disabled={inputLocked}
                    aria-label="Exercise input"
                  />
                  <Button type="submit" disabled={inputLocked || !input.trim()}>
                    <Send className="h-4 w-4" aria-hidden />
                    Transmit
                  </Button>
                </form>
              )}
            </div>
          </CardContent>
        </Card>

        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-red-400">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                Critical Alerts
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {alerts.length === 0 ? (
                <p className="text-sm text-zinc-500">No active alerts.</p>
              ) : (
                alerts.map((alert, index) => (
                  <Badge
                    key={`${alert}-${index}`}
                    variant="destructive"
                    className="animate-pulse whitespace-normal text-left"
                  >
                    {unmaskOutput(alert)}
                  </Badge>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-emerald-400">
                <ShieldCheck className="h-4 w-4" aria-hidden />
                Privacy Ledger (local only)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(entityMap).length === 0 ? (
                <p className="text-sm text-zinc-500">No entities masked yet.</p>
              ) : (
                <ul className="space-y-1 font-mono text-xs">
                  {Object.entries(entityMap).map(([tag, real]) => (
                    <li key={tag} className="flex justify-between gap-2">
                      <span className="text-emerald-300">{tag}</span>
                      <span className="truncate text-zinc-400">{real}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-mono text-xs uppercase tracking-widest text-zinc-400">
                Exercise Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 font-mono text-xs text-zinc-300">
              <p>
                Turns: <span className="text-zinc-100">{ttx.turns.length}</span>
              </p>
              <p>
                Elapsed:{" "}
                <span className="text-zinc-100">
                  {ttx.hoursElapsed}h / {TARGET_DURATION_HOURS}h
                </span>
              </p>
              <p>
                Outcome:{" "}
                <span className="text-zinc-100">
                  {ttx.outcome ? ttx.outcome.toUpperCase() : "IN PROGRESS"}
                </span>
              </p>
            </CardContent>
          </Card>

          {serverConfig?.mode === "self-hosted" && (
            <ProviderSettingsCard config={serverConfig} />
          )}
        </aside>
      </main>
    </div>
  );
}

function MessageBubble({ message }: { message: TtxUIMessage }) {
  if (message.role === "user") {
    const text = message.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");
    return (
      <div className="ml-auto max-w-[85%] rounded-lg border border-zinc-700 bg-zinc-800/80 px-4 py-3">
        <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          Participant · sanitized transmission
        </p>
        <p className="whitespace-pre-wrap text-sm">{text}</p>
      </div>
    );
  }

  return (
    <div className="max-w-[85%] space-y-3 rounded-lg border border-zinc-800 bg-slate-900 px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-sky-400">
        Exercise Controller
      </p>
      {message.parts.map((part, index) => {
        switch (part.type) {
          case "text":
            return part.text.trim() ? (
              <p key={index} className="whitespace-pre-wrap text-sm">
                {unmaskOutput(part.text)}
              </p>
            ) : null;
          case "tool-generate_turn":
            return part.state === "output-error" ? (
              <p key={index} className="text-sm text-red-300">
                {part.errorText}
              </p>
            ) : (
              <TurnView key={index} turn={part.input} />
            );
          case "tool-after_action_report":
            return part.state === "output-error" ? (
              <p key={index} className="text-sm text-red-300">
                {part.errorText}
              </p>
            ) : (
              <ReportView key={index} report={part.input} />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

function TurnView({ turn }: { turn?: DeepPartial<TurnOutput> }) {
  if (!turn) return null;
  return (
    <div className="space-y-3">
      {turn.time_elapsed && (
        <p className="font-mono text-xs text-zinc-400">[{turn.time_elapsed}]</p>
      )}
      {turn.narrative_response && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {unmaskOutput(turn.narrative_response)}
        </p>
      )}
      {turn.new_inject && (
        <div className="rounded-md border border-amber-900/70 bg-amber-950/40 p-3">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-amber-400">
            Inject
          </p>
          <p className="whitespace-pre-wrap text-sm text-amber-100">
            {unmaskOutput(turn.new_inject)}
          </p>
        </div>
      )}
    </div>
  );
}

function ReportView({ report }: { report?: DeepPartial<AfterActionReport> }) {
  if (!report) return null;
  const sections: Array<[string, (string | undefined)[] | undefined]> = [
    ["Strengths", report.strengths],
    ["Supply Gaps", report.supply_gaps],
    ["Recommendations", report.recommendations],
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="font-mono text-3xl font-bold text-zinc-100">
          {report.overall_grade ?? "…"}
        </span>
        <div className="font-mono text-xs text-zinc-400">
          {report.score !== undefined && <p>SCORE {report.score}/100</p>}
          {report.outcome && <p>OUTCOME {report.outcome.toUpperCase()}</p>}
        </div>
      </div>
      {report.summary && <p className="text-sm">{unmaskOutput(report.summary)}</p>}
      {sections.map(([title, items]) =>
        items?.length ? (
          <div key={title}>
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              {title}
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
              {items.map((item, index) =>
                item ? (
                  <li
                    key={index}
                    className={title === "Supply Gaps" ? "text-red-300" : undefined}
                  >
                    {unmaskOutput(item)}
                  </li>
                ) : null,
              )}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}
