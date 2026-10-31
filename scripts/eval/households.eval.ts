/**
 * Plays each test household (lib/test-households.ts) through a running
 * ReadyState server, the way the app does: the wizard's masked summary first,
 * then one of the offered responses each turn, then the debrief. Writes a
 * readable report per household and a summary of automatic checks to
 * eval-results/<timestamp>/. See scripts/eval/README.md for options.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readUIMessageStream, type UIMessageChunk } from "ai";
import { afterAll, describe, expect, it } from "vitest";

import { privateTerms } from "@/lib/household";
import { engineBaseline } from "@/lib/inventory";
import { PRIVACY_LEAKS, TEST_HOUSEHOLDS, type TestHousehold } from "@/lib/test-households";
import { deriveTtxState, improvementText, type AfterActionReport, type TtxUIMessage, type TurnOutput } from "@/lib/ttx";
import { usePrivacyStore } from "@/store/usePrivacyStore";
import { maskInput } from "@/utils/obfuscator";

import { CHECK_CATEGORIES, contentFindings, type CheckCategory, type Finding } from "./checks";
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
const DEBRIEF_REQUEST = "The exercise is over. Please prepare the debrief.";

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
  inputTokens?: number;
  outputTokens?: number;
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

async function send(messages: TtxUIMessage[]): Promise<SendOutcome<TtxUIMessage>> {
  const res = await fetch(`${BASE_URL}/api/ttx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    const state = deriveTtxState(messages);
    next = replay.resend ?? (state.phase === "ended" ? DEBRIEF_REQUEST : mask(pick(state.latestTurn!.response_options, start - 1)));
    result.notes.push(`Replayed ${start} turns from ${REPLAY}${replay.resend ? "; resent the failed call" : ""}`);
  }

  for (let i = start; i <= MAX_TURNS; i++) {
    messages.push(userMessage(`u${i}`, next));
    const outcome = await sendWithRetries(() => send(messages), { sleep, notes: result.notes, label: `Call ${i + 1}` });
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
      inputTokens: metadata?.usage?.inputTokens,
      outputTokens: metadata?.usage?.outputTokens,
    };
    if (outcome.error || !outcome.message) {
      result.turns.push({ ...record, error: outcome.error });
      result.findings.push({ category: "completion", text: `Call ${i + 1} failed: ${outcome.error}` });
      break;
    }
    messages.push({ ...outcome.message, id: `a${i}` });
    const state = deriveTtxState(messages);

    if (state.report) {
      result.report = state.report;
      result.debrief = record;
      break;
    }
    result.turns.push({ ...record, turn: state.latestTurn });
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
  const participantText = messages
    .filter((m) => m.role === "user")
    .flatMap((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")));

  // Privacy: nothing private in anything sent.
  const sent = participantText.join("\n");
  const secrets = [...privateTerms(result.household.profile), ...(result.household.id === "privacy" ? PRIVACY_LEAKS : [])];
  const leaked = secrets.filter((secret) => containsWord(sent, secret));
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
  findings.push(...contentFindings({ baseline: result.baseline, turns, participantText, report: result.report, replayedTurns }));

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
    `Input tokens per call: max ${inputs.length ? Math.max(...inputs) : "n/a"}, average ${inputs.length ? Math.round(sum(inputs) / inputs.length) : "n/a"}; output tokens total ${sum(outputs)}`,
    `Average request time ${calls.length ? Math.round(sum(calls.map((c) => c.requestMs)) / calls.length) : 0} ms; waited ${Math.round(sum(calls.map((c) => c.waitedMs)) / 1000)} s for rate limits`,
    `Server retries over ${calls.length} calls: ${schemaRetries} after a malformed turn, ${rateLimitRetries} after a rate limit, ${sum(calls.map((call) => call.debriefRepairs ?? 0))} debrief repair(s)`,
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
    : `_Request ${call.requestMs} ms, waited ${Math.round(call.waitedMs / 1000)} s, ${call.attempts} request(s), ${call.providerCalls ?? "?"} provider call(s) (${call.schemaRetries ?? 0} schema retries, ${call.debriefRepairs ?? 0} debrief repairs), ${call.inputTokens ?? "?"} input / ${call.outputTokens ?? "?"} output tokens._`;

function reportMarkdown({ household, baseline, turns, debrief, report, findings, notes }: Result) {
  const out = [
    `# ${household.persona}`,
    "",
    `**What this household tests:** ${household.tests}`,
    "",
    "## Checks",
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

const households = TEST_HOUSEHOLDS.filter((household) => !ONLY || ONLY.includes(household.id));
const results: Result[] = [];

describe(`test households against ${BASE_URL}`, () => {
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
        `Server ${BASE_URL}; model ${SETTINGS ? `${SETTINGS.provider}/${SETTINGS.model ?? "default"}` : "server default"}; up to ${MAX_TURNS} turns; responses chosen "${CHOOSE}"${REPLAY ? `; replaying ${REPLAY}` : ""}.`,
        "",
        "Completing an exercise is reported separately from its content: a run can finish and still have continuity, safety or suitability problems. Content checks are heuristics: passing means \"passed the implemented checks\", not verified safe or accurate. A valid citation shows the cited event exists, not that the advice describes it correctly. Findings from replayed turns are listed but not counted.",
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
    // Privacy leaks and failed calls fail the run; other findings are for review.
    expect(result.findings.filter((f) => f.category === "privacy" || f.text.includes("failed"))).toEqual([]);
  });
});
