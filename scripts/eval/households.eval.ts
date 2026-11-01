/**
 * Plays each test household (lib/test-households.ts) through a running
 * ReadyState server, the way the app does: the wizard's masked summary first,
 * then one of the offered responses each turn, then the debrief. Writes a
 * readable report per household and a summary of automatic checks to
 * eval-results/<timestamp>/. See scripts/eval/README.md for options.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readUIMessageStream, type UIMessageChunk } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CAPTURE_HEADER, type DebriefCapture } from "@/lib/debrief-capture";
import { EVAL_BUDGET_HEADER, EVAL_MAX_OUTPUT_HEADER } from "@/lib/eval-call-budget";
import { leakedTerms, privateTerms } from "@/lib/household";
import { engineBaseline } from "@/lib/inventory";
import { PRIVACY_LEAKS, TEST_HOUSEHOLDS, type TestHousehold } from "@/lib/test-households";
import {
  DEBRIEF_REQUEST,
  OMITTED_IMPROVEMENT_NOTICE,
  TARGET_DURATION_HOURS,
  deriveTtxState,
  improvementText,
  participantResponses,
  type AfterActionReport,
  type ProviderCallUsage,
  type TtxUIMessage,
  type TurnOutput,
} from "@/lib/ttx";
import { usePrivacyStore } from "@/store/usePrivacyStore";
import { maskInput } from "@/utils/obfuscator";

import { CHECK_CATEGORIES, contentFindings, type CheckCategory, type Finding } from "./checks";
import { MAX_PROVIDER_CALLS_PER_REQUEST, chargeRequest, overBound, reportedTokens } from "./budget";
import { sendWithRetries, type SendOutcome } from "./retry";

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";
const ONLY = process.env.EVAL_ONLY?.split(",").map((id) => id.trim());
/** Stop after this many turns; the debrief only runs if the exercise reached its end. */
const MAX_TURNS = Number(process.env.EVAL_TURNS ?? 14);
/** Pause between calls, to stay under the provider's tokens-per-minute limit. */
const DELAY_MS = Number(process.env.EVAL_DELAY_MS ?? 8000);
/** Which offered response to pick: "cycle" (1st, 2nd, 3rd, …), "first" or "last". */
const CHOOSE = process.env.EVAL_CHOOSE ?? "cycle";
/**
 * A previous run's folder. Each household replays that run's successful turns
 * without calling the model, then continues: a failed call is resent, and a
 * finished exercise goes straight to the debrief. For targeted reruns.
 */
const REPLAY = process.env.EVAL_REPLAY;
/**
 * Asks the server for every debrief draft, rejected ones included, and writes
 * them to <household>-debrief-drafts.json and .md for manual review. The
 * server must also set READYSTATE_CAPTURE_DEBRIEF_DRAFTS=1 (lib/debrief-capture.ts).
 */
const CAPTURE = process.env.EVAL_CAPTURE_DRAFTS === "1";
/** Replay only the first N successful turns of EVAL_REPLAY, then continue live (G6: Hours 0–66 of a run that ended at Hour 72). */
const REPLAY_TURNS = process.env.EVAL_REPLAY_TURNS ? Number(process.env.EVAL_REPLAY_TURNS) : undefined;
/**
 * The exercise clock the server must report before any call: set READYSTATE_EVAL_TARGET_HOURS on the local server
 * (lib/exercise-clock.ts) to the same value. Checked whenever this or EVAL_BUDGET is set.
 */
const EXERCISE_HOURS = Number(process.env.EVAL_EXERCISE_HOURS ?? TARGET_DURATION_HOURS);
/**
 * A hard token cap for the run, enforced by the server before every provider call (lib/eval-call-budget.ts; start it
 * with READYSTATE_EVAL_BUDGET=1). Setting it also turns off the eval's own resends, so each turn is one request.
 */
const BUDGET = process.env.EVAL_BUDGET ? Number(process.env.EVAL_BUDGET) : undefined;
/** The output limit the server enforces on each provider call in a budgeted run. */
const MAX_OUTPUT = Number(process.env.EVAL_MAX_OUTPUT ?? 2500);
/** Without a budget, what a call without reported usage is charged: the old per-call allowance. */
const UNBUDGETED_CALL_CHARGE = 8000;
/** G6's target for a single provider call's input on a turn. */
const G6_INPUT_TARGET = 5000;
/** The run's tokens: reported by the provider, and charged against the budget. */
const spend = { reported: 0, charged: 0 };

const outDir = path.join("eval-results", new Date().toISOString().replace(/[:.]/g, "-"));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const containsWord = (text: string, word: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, "iu").test(text);

interface CallRecord {
  sent: string;
  /** The final request alone, without waits. */
  requestMs: number;
  /** Time spent waiting out rate limits. */
  waitedMs: number;
  /** Requests the eval made for this call (more than 1 after a wait or resubmit). */
  attempts: number;
  /** Provider calls the server made for the final request, including the SDK's rate-limit retries. */
  providerCalls?: number;
  /** Of those, retries after a malformed tool call. */
  schemaRetries?: number;
  /** Debrief repairs after failed content checks. */
  debriefRepairs?: number;
  /** What the debrief's first attempt failed, before the server repaired it. */
  failedFirst?: string[];
  /** What a rejected repair still failed. */
  stillFailing?: string[];
  /** An improvement the server dropped after the repair, with the checks it failed. */
  omittedImprovement?: { action: string; checks: string[] };
  /** The whole response's usage: for a debrief, the first draft plus any repair. Not one call's size: see `calls`. */
  inputTokens?: number;
  outputTokens?: number;
  /** Each provider call's own usage, retries and repairs included. */
  calls?: ProviderCallUsage[];
  /** Charged against the budget: each call's reported usage, or its allowance when it reported none. */
  charged?: number;
  turn?: TurnOutput;
  error?: string;
  /** Copied from EVAL_REPLAY without calling the model. */
  replayed?: boolean;
}

interface Result {
  household: TestHousehold;
  baseline: string;
  turns: CallRecord[];
  debrief?: CallRecord;
  report?: AfterActionReport;
  findings: Finding[];
  notes: string[];
}

/** Parses the UI message stream, keeping any error chunk's text for the report. */
const toChunks = (onError: (text: string) => void) => {
  let buffer = "";
  return new TransformStream<string, UIMessageChunk>({
    transform(text, controller) {
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
        const chunk = JSON.parse(line.slice(6)) as UIMessageChunk;
        if (chunk.type === "error") onError(chunk.errorText);
        controller.enqueue(chunk);
      }
    },
  });
};

/** Settings sent like the app's Settings panel, to test another provider or model. */
const SETTINGS =
  process.env.EVAL_PROVIDER || process.env.EVAL_MODEL
    ? { provider: process.env.EVAL_PROVIDER ?? "groq", model: process.env.EVAL_MODEL }
    : undefined;

/** What's left of the run's budget: sent with each request, for the server to enforce. */
const remainingBudget = () => (BUDGET === undefined ? undefined : Math.max(0, BUDGET - spend.charged));

async function send(messages: TtxUIMessage[]): Promise<SendOutcome<TtxUIMessage>> {
  const remaining = remainingBudget();
  const res = await fetch(`${BASE_URL}/api/ttx`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CAPTURE ? { [CAPTURE_HEADER]: "1" } : {}),
      ...(remaining !== undefined ? { [EVAL_BUDGET_HEADER]: String(remaining), [EVAL_MAX_OUTPUT_HEADER]: String(MAX_OUTPUT) } : {}),
    },
    body: JSON.stringify({ messages, settings: SETTINGS }),
  });
  if (!res.ok || !res.body) return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` };
  let streamError: string | undefined;
  let last: TtxUIMessage | undefined;
  for await (const message of readUIMessageStream<TtxUIMessage>({
    stream: res.body.pipeThrough(new TextDecoderStream()).pipeThrough(toChunks((text) => (streamError = text))),
  })) {
    last = message;
  }
  const failed = last?.parts.find((part) => "state" in part && part.state === "output-error");
  // A rejected debrief still carries the server's counters in its metadata.
  if (streamError) return { error: streamError, message: last };
  if (!last || failed) return { error: failed && "errorText" in failed ? String(failed.errorText) : "empty response" };
  return { message: last };
}

const pick = (options: string[], turnIndex: number) => {
  if (CHOOSE === "first") return options[0];
  if (CHOOSE === "last") return options.at(-1)!;
  return options[turnIndex % options.length];
};

const userMessage = (id: string, text: string): TtxUIMessage => ({ id, role: "user", parts: [{ type: "text", text }] });

/** A saved turn as the assistant message the app would hold. */
const turnMessage = (id: string, turn: TurnOutput): TtxUIMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "tool-generate_turn", toolCallId: `replay-${id}`, state: "output-available", input: turn, output: turn }],
});

/** The successful turns of a household's previous run, and the call that failed after them, if any. */
function loadReplay(householdId: string) {
  if (!REPLAY) return undefined;
  const saved = (JSON.parse(readFileSync(path.join(REPLAY, "results.json"), "utf8")) as Array<{
    household: { id: string };
    turns: Array<{ sent: string; turn?: TurnOutput; error?: string }>;
  }>).find((r) => r.household.id === householdId);
  if (!saved) return undefined;
  const succeeded = saved.turns.filter((record) => record.turn);
  const failed = saved.turns.find((record) => record.error);
  if (REPLAY_TURNS !== undefined && REPLAY_TURNS < succeeded.length) return { succeeded: succeeded.slice(0, REPLAY_TURNS), resend: undefined };
  return { succeeded, resend: failed?.sent };
}

async function play(household: TestHousehold): Promise<Result> {
  usePrivacyStore.getState().clearMappings();
  const { profile } = household;
  const alwaysMask = privateTerms(profile);
  const mask = (text: string) => maskInput(text, { alwaysMask });

  const baseline = engineBaseline(profile, mask);
  const result: Result = { household, baseline, turns: [], findings: [], notes: [] };
  const messages: TtxUIMessage[] = [];
  let next = baseline;
  let start = 0;

  const replay = loadReplay(household.id);
  if (replay?.succeeded.length) {
    replay.succeeded.forEach((record, i) => {
      messages.push(userMessage(`u${i}`, record.sent), turnMessage(`a${i}`, record.turn!));
      result.turns.push({ sent: record.sent, requestMs: 0, waitedMs: 0, attempts: 0, turn: record.turn, replayed: true });
    });
    start = replay.succeeded.length;
    const state = deriveTtxState(messages, EXERCISE_HOURS);
    next = replay.resend ?? (state.phase === "ended" ? DEBRIEF_REQUEST : mask(pick(state.latestTurn!.response_options, start - 1)));
    result.notes.push(`Replayed ${start} turns from ${REPLAY}${replay.resend ? "; resent the failed call" : ""}`);
  }

  for (let i = start; i <= MAX_TURNS; i++) {
    const remaining = remainingBudget();
    if (remaining === 0) {
      result.findings.push({ category: "completion", text: `Call ${i + 1} not sent: the ${BUDGET}-token budget is spent, with ${spend.charged} charged` });
      break;
    }
    messages.push(userMessage(`u${i}`, next));
    const outcome = await sendWithRetries(() => send(messages), {
      sleep,
      notes: result.notes,
      label: `Call ${i + 1}`,
      ...(BUDGET !== undefined ? { maxWaits: 0, resubmit: false } : {}),
    });
    const metadata = outcome.message?.metadata;
    const record: CallRecord = {
      sent: next,
      requestMs: outcome.requestMs,
      waitedMs: outcome.waitedMs,
      attempts: outcome.attempts,
      providerCalls: metadata?.providerCalls,
      schemaRetries: metadata?.schemaRetries,
      debriefRepairs: metadata?.debriefRepairs,
      failedFirst: metadata?.debriefChecks?.failedFirst,
      stillFailing: metadata?.debriefChecks?.stillFailing,
      omittedImprovement: metadata?.debriefChecks?.omittedImprovement,
      inputTokens: metadata?.usage?.inputTokens,
      outputTokens: metadata?.usage?.outputTokens,
      calls: metadata?.calls,
      // The server never reserves past what was sent, so a request without per-call metadata is charged all of it.
      charged:
        remaining !== undefined
          ? chargeRequest(metadata?.calls, remaining, remaining)
          : chargeRequest(metadata?.calls, UNBUDGETED_CALL_CHARGE, UNBUDGETED_CALL_CHARGE * MAX_PROVIDER_CALLS_PER_REQUEST),
    };
    spend.charged += record.charged!;
    spend.reported += (record.calls ?? []).reduce((sum, call) => sum + (reportedTokens(call) ?? 0), 0);
    const over = BUDGET !== undefined ? overBound(record.calls) : [];
    const stopOver = () =>
      result.findings.push({
        category: "completion",
        text: `Call ${i + 1} over its bound: ${over.map((c) => `a provider call reported ${c.inputTokens} input tokens (bound ${c.inputBound}) and ${c.outputTokens} output (limit ${c.maxOutputTokens})`).join("; ")}, so the budget's guarantee no longer holds and the run stopped`,
      });
    if (metadata?.debriefCapture) writeCapture(household, record, outcome.error, metadata.debriefCapture);
    if (metadata?.budgetStop) {
      result.turns.push({ ...record, error: outcome.error });
      const { needed, remaining: left } = metadata.budgetStop;
      result.findings.push({
        category: "completion",
        text: `Call ${i + 1} stopped by the budget: its next provider call needed up to ${needed} tokens and ${left} remained, so the server didn't send it`,
      });
      break;
    }
    if (outcome.error || !outcome.message) {
      result.turns.push({ ...record, error: outcome.error });
      result.findings.push({ category: "completion", text: `Call ${i + 1} failed: ${outcome.error}` });
      break;
    }
    messages.push({ ...outcome.message, id: `a${i}` });
    const state = deriveTtxState(messages, EXERCISE_HOURS);

    if (state.report) {
      result.report = state.report;
      result.debrief = record;
      if (over.length) stopOver();
      break;
    }
    result.turns.push({ ...record, turn: state.latestTurn });
    if (over.length) {
      stopOver();
      break;
    }
    if (state.phase === "ended") next = DEBRIEF_REQUEST;
    else {
      const options = state.latestTurn?.response_options ?? [];
      if (!options.length) {
        result.findings.push({ category: "structure", text: `${state.latestTurn?.time_elapsed}: no response options offered` });
        break;
      }
      // Options come back masked; the app shows them unmasked and re-masks on
      // send, which round-trips to the same text.
      next = mask(pick(options, i));
    }
    await sleep(DELAY_MS);
  }

  check(result, messages);
  return result;
}

function check(result: Result, messages: TtxUIMessage[]) {
  const { findings } = result;
  const add = (category: CheckCategory, text: string) => findings.push({ category, text });
  const turns = result.turns.flatMap((record) => (record.turn ? [record.turn] : []));
  // Privacy: nothing private in anything sent, resent messages included.
  const sent = messages
    .filter((m) => m.role === "user")
    .flatMap((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")))
    .join("\n");
  const leaked = [
    ...leakedTerms(sent, privateTerms(result.household.profile)),
    ...(result.household.id === "privacy" ? PRIVACY_LEAKS.filter((leak) => containsWord(sent, leak)) : []),
  ];
  if (leaked.length) add("privacy", `Sent ${leaked.map((s) => `"${s}"`).join(", ")}`);

  // Structure: feedback after every response, options on every ongoing turn, a clock that moves.
  turns.slice(1).forEach((turn) => {
    if (!turn.feedback) add("structure", `${turn.time_elapsed}: no feedback on the response`);
  });
  turns.forEach((turn) => {
    const count = turn.response_options?.length ?? 0;
    if (turn.scenario_status === "ongoing" && (count < 3 || count > 4)) {
      add("structure", `${turn.time_elapsed}: ${count} response options (expected 3–4)`);
    }
  });
  if (turns.some((turn, i) => i > 0 && turn.hours_elapsed <= turns[i - 1].hours_elapsed)) {
    add("structure", "Clock did not move forward every turn");
  }

  // Completion: the exercise reached its end and the debrief.
  if (!result.report && !findings.some((f) => f.category === "completion")) {
    add("completion", `Stopped at ${turns.at(-1)?.time_elapsed ?? "the start"} (EVAL_TURNS=${MAX_TURNS}); no debrief`);
  }

  // Continuity, safety, suitability (scripts/eval/checks.ts).
  const replayedTurns = result.turns.filter((record) => record.replayed).length;
  findings.push(...contentFindings({ baseline: result.baseline, turns, participantText: participantResponses(messages).responses, report: result.report, replayedTurns }));

  const calls = [...result.turns, ...(result.debrief ? [result.debrief] : [])].filter(
    // A rejected debrief still used the provider, and reports what it used.
    (call) => !call.replayed && (!call.error || call.providerCalls !== undefined),
  );
  const rejected = calls.find((call) => call.stillFailing?.length || (call.error && call.failedFirst?.length));
  const inputs = calls.flatMap((call) => (call.inputTokens !== undefined ? [call.inputTokens] : []));
  const outputs = calls.flatMap((call) => (call.outputTokens !== undefined ? [call.outputTokens] : []));
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const schemaRetries = sum(calls.map((call) => call.schemaRetries ?? 0));
  // Provider calls beyond one per attempt: each repair is its own attempt.
  const rateLimitRetries = sum(
    calls.map((call) => (call.providerCalls ?? 1) - 1 - (call.schemaRetries ?? 0) - (call.debriefRepairs ?? 0)),
  );
  result.notes.push(
    `${turns.length} turns, reached ${turns.at(-1)?.time_elapsed ?? "Hour 0"}${result.report ? ", debrief written" : ""}`,
    `Input tokens per response (generation plus any retry or repair): max ${inputs.length ? Math.max(...inputs) : "n/a"}, average ${inputs.length ? Math.round(sum(inputs) / inputs.length) : "n/a"}; output tokens total ${sum(outputs)}`,
    largestTurnCall(result),
    `Average request time ${calls.length ? Math.round(sum(calls.map((c) => c.requestMs)) / calls.length) : 0} ms; waited ${Math.round(sum(calls.map((c) => c.waitedMs)) / 1000)} s for rate limits`,
    `Server retries over ${calls.length} calls: ${schemaRetries} after a malformed turn, ${rateLimitRetries} after a rate limit, ${sum(calls.map((call) => call.debriefRepairs ?? 0))} debrief repair(s)`,
    ...(result.debrief?.omittedImprovement
      ? [
          `Debrief shown with one improvement omitted by the server (${result.debrief.omittedImprovement.checks.join(", ")}): "${result.debrief.omittedImprovement.action}"; the participant was told`,
        ]
      : []),
    ...(result.debrief?.failedFirst?.length
      ? [`Debrief passed the implemented checks after a repair; the first attempt failed: ${result.debrief.failedFirst.join(" / ")}`]
      : result.debrief
        ? ["Debrief passed the implemented checks on the first attempt"]
        : rejected
          ? [
              `Debrief rejected, not shown; the first attempt failed: ${rejected.failedFirst?.join(" / ")}`,
              ...(rejected.stillFailing ? [`The repair still failed: ${rejected.stillFailing.join(" / ")}`] : []),
            ]
          : []),
  );
}

const list = (items: string[]) => (items.length ? items.map((item) => `- ${item}`).join("\n") : "- (none)");
const CATEGORY_LABELS: Record<CheckCategory, string> = {
  privacy: "Privacy",
  completion: "Completion",
  structure: "Structure",
  continuity: "Continuity",
  citation: "Citations",
  accuracy: "Known inaccuracies",
  safety: "Safety",
  suitability: "Suitability for the household",
};
/** New-output findings in a category. Known defects of replayed turns are listed separately. */
const byCategory = (findings: Finding[], category: CheckCategory) =>
  findings.filter((f) => f.category === category && !f.replayed);

const callLine = (call: CallRecord) =>
  call.replayed
    ? "_Replayed from an earlier run._"
    : `_Request ${call.requestMs} ms, waited ${Math.round(call.waitedMs / 1000)} s, ${call.attempts} request(s), ${call.providerCalls ?? "?"} provider call(s) (${call.schemaRetries ?? 0} schema retries, ${call.debriefRepairs ?? 0} debrief repairs), ${call.inputTokens ?? "?"} input / ${call.outputTokens ?? "?"} output tokens for the whole response._`;

/** The live calls in order, with the label each has in the report. */
const liveCalls = ({ turns, debrief }: Result) => [
  ...turns.flatMap((call, index) => (call.replayed ? [] : [{ label: `Call ${index + 1}, ${call.turn?.time_elapsed ?? "no turn"}`, call, kind: "turn" as const }])),
  ...(debrief ? [{ label: "Debrief", call: debrief, kind: "debrief" as const }] : []),
];

/** G6's measure: the largest input of any single provider call on a turn, against its 5,000-token target. */
function largestTurnCall(result: Result) {
  const inputs = liveCalls(result)
    .filter(({ kind }) => kind === "turn")
    .flatMap(({ call }) => (call.calls ?? []).flatMap((c) => (c.inputTokens !== undefined ? [c.inputTokens] : [])));
  if (!inputs.length) return "Largest single provider call's input on a turn: n/a (no per-call usage reported)";
  const largest = Math.max(...inputs);
  return `Largest single provider call's input on a turn: ${largest} (G6 target ${G6_INPUT_TARGET}: ${largest < G6_INPUT_TARGET ? "under" : "**not met**"})`;
}

/** Each provider call's own usage, apart from each response's total (generation plus any retry or repair). */
function tokenSection(result: Result) {
  const rows = liveCalls(result).flatMap(({ label, call, kind }) => {
    const calls = call.calls ?? [];
    const total = `| ${label} | **response total** | ${call.inputTokens ?? "?"} | ${call.outputTokens ?? "?"} | | | ${call.charged ?? "?"} | |`;
    if (!calls.length) return [`| ${label} | no per-call usage reported | | | | | ${call.charged ?? "?"} | |`];
    return [
      ...calls.map((c, n) => {
        const reported = reportedTokens(c);
        const what = c.rejected ? `rejected${c.status !== undefined ? ` (status ${c.status})` : ""}` : reported === undefined ? "no usage reported (cut off)" : "reported";
        const target = kind === "turn" && c.inputTokens !== undefined ? (c.inputTokens < G6_INPUT_TARGET ? "under" : "**over**") : "";
        return `| ${label} | provider call ${n + 1}: ${what} | ${c.inputTokens ?? ""} | ${c.outputTokens ?? ""} | ${c.inputBound ?? ""} | ${c.maxOutputTokens ?? ""} | ${reported ?? c.reserved ?? UNBUDGETED_CALL_CHARGE} | ${target} |`;
      }),
      ...(calls.length > 1 ? [total] : []),
    ];
  });
  if (!rows.length) return [];
  return [
    "## Tokens per provider call",
    "",
    `Each provider call's own usage, apart from each response's total, which adds retries and, for a debrief, the repair. In a budgeted run the server enforced each call's input bound and output limit before sending it. Charged: a call's reported usage, or, when it reported none, its whole reserve (bound plus limit; ${UNBUDGETED_CALL_CHARGE} without a budget). G6's target applies to a single turn call's input.`,
    "",
    `| Call | Provider call | Input | Output | Input bound | Output limit | Charged | Input vs ${G6_INPUT_TARGET} |`,
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ];
}

function reportMarkdown(result: Result) {
  const { household, baseline, turns, debrief, report, findings, notes } = result;
  const out = [
    `# ${household.persona}`,
    "",
    `**What this household tests:** ${household.tests}`,
    "",
    "## Manual quality verdict",
    "",
    "Pending: record it in docs/testing after reading every displayed line. Passing the automated checks below, or the test runner passing this household, isn't a quality verdict.",
    "",
    "## Automated content checks",
    "",
    ...CHECK_CATEGORIES.flatMap((category) => {
      const found = byCategory(findings, category);
      return [`**${CATEGORY_LABELS[category]}:** ${found.length ? `❌ ${found.length}` : "✅"}`, ...(found.length ? [list(found.map((f) => f.text)), ""] : [""])];
    }),
    ...(findings.some((f) => f.replayed)
      ? ["**Known from the replayed turns** (judged in the earlier run, not counted above):", list(findings.filter((f) => f.replayed).map((f) => `${f.category}: ${f.text}`)), ""]
      : []),
    list(notes),
    "",
    ...tokenSection(result),
    "## What the scenario engine received",
    "",
    "```text",
    baseline,
    "```",
  ];
  turns.forEach((call, index) => {
    const { sent, turn, error } = call;
    out.push("", `## ${turn?.time_elapsed ?? `Call ${index + 1}`}`, "", callLine(call), "");
    if (index > 0) out.push(`**Response sent:** ${sent}`, "");
    if (error) {
      out.push(`**Error:** ${error}`);
      return;
    }
    if (!turn) return;
    if (turn.feedback) {
      out.push(
        "**What you covered**",
        list(turn.feedback.covered),
        "",
        "**What to consider**",
        list(turn.feedback.consider),
        "",
        `**Why it matters:** ${turn.feedback.why}`,
        "",
      );
    }
    if (turn.suggested_actions.length) out.push("**Next steps for your real plan**", list(turn.suggested_actions), "");
    out.push(`**Outcome:** ${turn.narrative_response}`, "", `**Inject:** ${turn.new_inject}`, "");
    if (turn.critical_alerts.length) out.push("**Needs attention**", list(turn.critical_alerts), "");
    if (turn.response_options.length) out.push("**Options offered**", list(turn.response_options));
  });
  if (report) {
    out.push(
      "",
      "## Debrief",
      "",
      ...(debrief ? [callLine(debrief), ""] : []),
      report.summary,
      "",
      "**What you need to know**",
      list(report.need_to_know),
      "",
      "**What you can do better**",
      list(report.do_better.map(improvementText)),
      ...(debrief?.omittedImprovement ? ["", `_${OMITTED_IMPROVEMENT_NOTICE}_`] : []),
      "",
      "**What went well**",
      list(report.went_well),
      "",
      "**Supply checklist (optional)**",
      list(report.supply_checklist ?? []),
    );
  }
  return out.join("\n") + "\n";
}

/** The code the server ran, assuming it serves this working tree. */
function revision() {
  try {
    const commit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim() !== "";
    return { commit, dirty };
  } catch {
    return { commit: "unknown", dirty: false };
  }
}

const reportLines = (report: AfterActionReport) => [
  `**Summary:** ${report.summary}`,
  "",
  "**What you need to know**",
  list(report.need_to_know),
  "",
  "**What you can do better**",
  list(report.do_better.map(({ action, evidence, why }) => `${action}\n  - Evidence: ${evidence}\n  - Why: ${why}`)),
  "",
  "**What went well**",
  list(report.went_well),
  "",
  "**Supply checklist (optional)**",
  list(report.supply_checklist ?? []),
];

const cellText = (text: string) => text.replace(/\|/g, "\\|").replace(/\s+/g, " ");

/**
 * Every debrief draft of a call, for manual review. Identifies the household
 * by its synthetic id; the profile and the baseline stay out.
 */
function writeCapture(household: TestHousehold, call: CallRecord, error: string | undefined, capture: DebriefCapture) {
  mkdirSync(outDir, { recursive: true });
  const artifact = {
    note: "Debrief drafts captured for eval review. Rejected drafts were never shown to the participant.",
    household: { id: household.id, persona: household.persona },
    scenario: household.profile.scenario,
    revision: revision(),
    server: BASE_URL,
    delivered: !error,
    error,
    call: {
      requestMs: call.requestMs,
      waitedMs: call.waitedMs,
      attempts: call.attempts,
      providerCalls: call.providerCalls,
      schemaRetries: call.schemaRetries,
      debriefRepairs: call.debriefRepairs,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
    },
    ...capture,
  };
  writeFileSync(path.join(outDir, `${household.id}-debrief-drafts.json`), JSON.stringify(artifact, null, 2));
  const { revision: rev, call: c } = artifact;
  const md = [
    `# Debrief drafts: ${household.persona}`,
    "",
    `${artifact.note}`,
    "",
    `Scenario ${artifact.scenario}; model ${capture.provider}/${capture.model}; code ${rev.commit.slice(0, 7)}${rev.dirty ? " (uncommitted changes)" : ""}.`,
    `Delivered: ${error ? `**no**, the participant got the error "${error}"` : capture.omitted ? "yes, **with one improvement omitted by the server**" : "yes"}.`,
    `Request ${c.requestMs} ms; ${c.providerCalls ?? "?"} provider call(s), ${c.schemaRetries ?? 0} schema retries, ${c.debriefRepairs ?? 0} debrief repair(s); ${c.inputTokens ?? "?"} input / ${c.outputTokens ?? "?"} output tokens.`,
    "",
    ...capture.drafts.flatMap((draft) => [
      `## ${draft.attempt === "first" ? "First draft" : "Repair"}: ${draft.status === "rejected" ? "REJECTED, not displayed" : "accepted"}`,
      "",
      `_${draft.ms} ms, ${draft.usage.inputTokens} input / ${draft.usage.outputTokens} output tokens._`,
      "",
      ...reportLines(draft.report),
      "",
      ...(draft.failedChecks.length
        ? [
            "**Failed checks**",
            "",
            "| Check | Field | Matched | Problem |",
            "| --- | --- | --- | --- |",
            ...draft.failedChecks.map((p) => `| ${p.check} | ${p.field} | ${cellText(p.matched)} | ${cellText(p.problem)} |`),
          ]
        : ["**Failed checks:** none."]),
      "",
    ]),
    ...(capture.omitted
      ? [
          "## Final displayed version: the repair with one improvement omitted by the server",
          "",
          `Omitted (${capture.omitted.checks.join(", ")}): "${capture.omitted.action}". Its evidence and reason went with it; the checklist is unchanged. The participant was told one improvement was omitted.`,
          "",
          ...reportLines(capture.omitted.report),
          "",
          "**Failed checks:** none, after the omission.",
          "",
        ]
      : []),
    "## Known story defects given to the model",
    "",
    list(capture.knownStoryDefects.map(({ item, time, sentence }) => `${time}: the ${item}: "${sentence}"`)),
    "",
    `## Evidence given to the model (hours ${capture.evidence.hours.join(", ")})`,
    "",
    "The briefing without the household baseline:",
    "",
    "```text",
    capture.evidence.log,
    "```",
    "",
  ];
  writeFileSync(path.join(outDir, `${household.id}-debrief-drafts.md`), md.join("\n"));
}

const households = TEST_HOUSEHOLDS.filter((household) => !ONLY || ONLY.includes(household.id));
const results: Result[] = [];

describe(`test households against ${BASE_URL}`, () => {
  // A server without the capture flag would spend the run's tokens and save no drafts; one on a different clock would
  // measure a different game.
  beforeAll(async () => {
    const checkClock = BUDGET !== undefined || process.env.EVAL_EXERCISE_HOURS !== undefined;
    if (!CAPTURE && !checkClock) return;
    const res = await fetch(`${BASE_URL}/api/ttx`, { headers: { [CAPTURE_HEADER]: "1" } });
    const body = res.ok ? await res.json() : null;
    if (checkClock && body?.exerciseHours !== EXERCISE_HOURS) {
      throw new Error(
        `${BASE_URL} runs a ${body?.exerciseHours ?? "unknown"}-hour clock, not ${EXERCISE_HOURS}: start it with READYSTATE_EVAL_TARGET_HOURS=${EXERCISE_HOURS}. No model call was made.`,
      );
    }
    if (BUDGET !== undefined) {
      if (body?.evalBudget !== true) {
        throw new Error(`EVAL_BUDGET is set, but ${BASE_URL} won't enforce it: start it with READYSTATE_EVAL_BUDGET=1. No model call was made.`);
      }
      console.log(
        `Budget ${BUDGET} tokens, enforced by the server before every provider call; output limit ${MAX_OUTPUT} per call; the eval's own resends off; clock ${EXERCISE_HOURS} hours`,
      );
    }
    if (!CAPTURE) return;
    if (body?.captureDebriefDrafts !== true) {
      throw new Error(`EVAL_CAPTURE_DRAFTS=1, but ${BASE_URL} won't capture drafts: start it with READYSTATE_CAPTURE_DEBRIEF_DRAFTS=1. No model call was made.`);
    }
    console.log(`Draft capture confirmed on ${BASE_URL}`);
  });

  afterAll(() => {
    if (!results.length) return;
    const cell = (r: Result, category: CheckCategory) => {
      const count = byCategory(r.findings, category).length;
      return count ? `❌ ${count}` : "✅";
    };
    const rows = results.map(
      (r) =>
        `| [${r.household.persona}](${r.household.id}.md) | ${CHECK_CATEGORIES.map((c) => cell(r, c)).join(" | ")} | ⏳ pending | ${r.notes.join("; ")} |`,
    );
    const problems = results.flatMap((r) =>
      r.findings.map((f) => `- **${r.household.id}** (${f.category}${f.replayed ? ", known from replayed turns" : ""}): ${f.text}`),
    );
    writeFileSync(
      path.join(outDir, "summary.md"),
      [
        `# Household evaluation, ${new Date().toISOString()}`,
        "",
        `Server ${BASE_URL}; model ${SETTINGS ? `${SETTINGS.provider}/${SETTINGS.model ?? "default"}` : "server default"}; up to ${MAX_TURNS + 1} calls; responses chosen "${CHOOSE}"${REPLAY ? `; replaying ${REPLAY}${REPLAY_TURNS !== undefined ? ` (first ${REPLAY_TURNS} turns)` : ""}` : ""}; clock ${EXERCISE_HOURS} hours.`,
        "",
        `**Tokens:** ${spend.reported} reported tokens; ${spend.charged} conservatively charged against the budget${BUDGET !== undefined ? ` of ${BUDGET}` : ""}. The charge is budget accounting, not measured usage: a provider call without reported usage is charged its whole reserve (input bound plus output limit).`,
        "",
        "Completing an exercise is reported separately from its content: a run can finish and still have continuity, safety or suitability problems. Content checks are heuristics: passing means \"passed the implemented checks\", not verified safe or accurate. A valid citation shows the cited event exists, not that the advice describes it correctly. Findings from replayed turns are listed but not counted.",
        "",
        "**The test runner's pass or fail is not a quality result.** It fails a household only on a privacy leak, a failed call or a budget stop, so a passing household can still have every content finding below and an unreviewed debrief.",
        "",
        "**Manual review is a separate result.** The automated columns can all pass while the debrief fails a reading of every displayed line, including the checklist. The runner can't do that reading, so it's marked pending here; record it in docs/testing.",
        "",
        `| Household | ${CHECK_CATEGORIES.map((c) => CATEGORY_LABELS[c]).join(" | ")} | Manual review | Notes |`,
        `| --- | ${CHECK_CATEGORIES.map(() => "---").join(" | ")} | --- | --- |`,
        ...rows,
        "",
        "## Automated findings",
        "",
        problems.length ? problems.join("\n") : "None.",
        "",
      ].join("\n"),
    );
    writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
    console.log(`\nReports written to ${path.resolve(outDir)}`);
  });

  it.each(households.map((household) => [household.id, household] as const))("%s", async (_, household) => {
    mkdirSync(outDir, { recursive: true });
    const result = await play(household);
    results.push(result);
    writeFileSync(path.join(outDir, `${household.id}.md`), reportMarkdown(result));
    // Only a privacy leak, a failed call or a budget stop fails the test runner. That's a gate on the run, not a quality
    // result: content findings (grading language included) are reported for review, and the manual verdict is separate.
    expect(
      result.findings.filter((f) => f.category === "privacy" || (f.category === "completion" && /^Call \d+ (failed|not sent|stopped by the budget|over its bound):/.test(f.text))),
    ).toEqual([]);
  });
});
