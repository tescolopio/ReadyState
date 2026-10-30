/**
 * Plays each test household (lib/test-households.ts) through a running
 * ReadyState server, the way the app does: the wizard's masked summary first,
 * then one of the offered responses each turn, then the debrief. Writes a
 * readable report per household and a summary of automatic checks to
 * eval-results/<timestamp>/. See scripts/eval/README.md for options.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readUIMessageStream, type UIMessageChunk } from "ai";
import { afterAll, describe, expect, it } from "vitest";

import { privateTerms } from "@/lib/household";
import { SAFETY_RULES } from "@/lib/rules";
import { engineBaseline } from "@/lib/inventory";
import { PRIVACY_LEAKS, TEST_HOUSEHOLDS, type TestHousehold } from "@/lib/test-households";
import {
  deriveTtxState,
  type AfterActionReport,
  type TtxUIMessage,
  type TurnOutput,
} from "@/lib/ttx";
import { usePrivacyStore } from "@/store/usePrivacyStore";
import { maskInput } from "@/utils/obfuscator";

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";
const ONLY = process.env.EVAL_ONLY?.split(",").map((id) => id.trim());
/** Stop after this many turns; the debrief only runs if the exercise reached its end. */
const MAX_TURNS = Number(process.env.EVAL_TURNS ?? 14);
/** Pause between calls, to stay under the provider's tokens-per-minute limit. */
const DELAY_MS = Number(process.env.EVAL_DELAY_MS ?? 8000);
/** Which offered response to pick: "cycle" (1st, 2nd, 3rd, …), "first" or "last". */
const CHOOSE = process.env.EVAL_CHOOSE ?? "cycle";
const DEBRIEF_REQUEST = "The exercise is over. Please prepare the debrief.";

const outDir = path.join("eval-results", new Date().toISOString().replace(/[:.]/g, "-"));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const containsWord = (text: string, word: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, "iu").test(text);

/**
 * Advice that breaks a safety rule, using each rule's `detect` patterns from
 * data/rules/safety.json. Sentences matching the rule's `exceptWhen` are
 * warnings about the hazard, not advice. A heuristic for review, not a
 * guarantee: the model-judge version is work item G11.
 */
const DETECTORS = SAFETY_RULES.filter((rule) => rule.detect).map((rule) => ({
  id: rule.id,
  patterns: rule.detect!.map((pattern) => new RegExp(pattern, "i")),
  except: rule.exceptWhen ? new RegExp(rule.exceptWhen, "i") : undefined,
}));
const unsafeAdvice = (texts: string[]) =>
  texts
    .flatMap((text) => text.split(/(?<=[.!?])\s+/))
    .flatMap((sentence) =>
      DETECTORS.filter(
        (rule) => rule.patterns.some((pattern) => pattern.test(sentence)) && !rule.except?.test(sentence),
      ).map((rule) => `${rule.id}: "${sentence}"`),
    );

/** Grading language the debrief must avoid (decision D8). */
const VERDICT = /\b(grade|score|scored|passed|failed|you (won|lost)|verdict)\b/i;

interface TurnRecord {
  sent: string;
  ms: number;
  turn?: TurnOutput;
  error?: string;
}

interface Result {
  household: TestHousehold;
  baseline: string;
  turns: TurnRecord[];
  report?: AfterActionReport;
  problems: string[];
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

async function send(messages: TtxUIMessage[]): Promise<{ message?: TtxUIMessage; error?: string }> {
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
  if (streamError) return { error: streamError };
  if (!last || failed) return { error: failed && "errorText" in failed ? String(failed.errorText) : "empty response" };
  return { message: last };
}

/** Waits the app tells participants to wait, in ms: "Wait about 12 seconds" or "about 2 minutes". */
const rateLimitWait = (error: string) => {
  const match = error.match(/limiting requests.*?about (\d+) (second|minute)/i);
  if (!match) return undefined;
  return Number(match[1]) * (match[2].toLowerCase() === "minute" ? 60_000 : 1000) + 1000;
};
const MAX_RATE_LIMIT_WAITS = 3;

/**
 * Sends like a patient participant: waits out a per-minute limit and submits
 * again, and resubmits once after an incomplete turn (which the server has
 * already retried once). Each retry is noted so the report shows it.
 */
async function sendWithRetries(messages: TtxUIMessage[], notes: string[], label: string) {
  let waits = 0;
  let resubmitted = false;
  while (true) {
    const result = await send(messages);
    if (!result.error) return result;
    const wait = rateLimitWait(result.error);
    if (wait !== undefined && waits < MAX_RATE_LIMIT_WAITS) {
      waits++;
      notes.push(`${label}: rate limited, waited ${Math.round(wait / 1000)} s`);
      await sleep(wait);
      continue;
    }
    if (/incomplete turn/i.test(result.error) && !resubmitted) {
      resubmitted = true;
      notes.push(`${label}: incomplete turn after the server's retry; resubmitted`);
      continue;
    }
    return result;
  }
}

const pick = (options: string[], turnIndex: number) => {
  if (CHOOSE === "first") return options[0];
  if (CHOOSE === "last") return options.at(-1)!;
  return options[turnIndex % options.length];
};

async function play(household: TestHousehold): Promise<Result> {
  usePrivacyStore.getState().clearMappings();
  const { profile } = household;
  const alwaysMask = privateTerms(profile);
  const mask = (text: string) => maskInput(text, { alwaysMask });

  const baseline = engineBaseline(profile, mask);
  const result: Result = { household, baseline, turns: [], problems: [], notes: [] };
  const messages: TtxUIMessage[] = [];
  let next = baseline;

  for (let i = 0; i <= MAX_TURNS; i++) {
    messages.push({ id: `u${i}`, role: "user", parts: [{ type: "text", text: next }] });
    const started = performance.now();
    const { message, error } = await sendWithRetries(messages, result.notes, `Call ${i + 1}`);
    const ms = Math.round(performance.now() - started);
    if (error || !message) {
      result.turns.push({ sent: next, ms, error });
      result.problems.push(`Call ${i + 1} failed: ${error}`);
      break;
    }
    messages.push({ ...message, id: `a${i}` });
    const state = deriveTtxState(messages);

    if (state.report) {
      result.report = state.report;
      result.notes.push(`Debrief took ${ms} ms`);
      break;
    }
    result.turns.push({ sent: next, ms, turn: state.latestTurn });
    if (state.phase === "ended") next = DEBRIEF_REQUEST;
    else {
      const options = state.latestTurn?.response_options ?? [];
      if (!options.length) {
        result.problems.push(`${state.latestTurn?.time_elapsed}: no response options offered`);
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
  const { problems } = result;
  const turns = result.turns.flatMap((record) => (record.turn ? [record.turn] : []));

  // Privacy: nothing private in anything sent.
  const sent = messages
    .filter((m) => m.role === "user")
    .flatMap((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")))
    .join("\n");
  const secrets = [...privateTerms(result.household.profile), ...(result.household.id === "privacy" ? PRIVACY_LEAKS : [])];
  const leaked = secrets.filter((secret) => containsWord(sent, secret));
  if (leaked.length) problems.push(`PRIVACY: sent ${leaked.map((s) => `"${s}"`).join(", ")}`);

  // Structure: feedback after every response, options on every ongoing turn.
  turns.slice(1).forEach((turn) => {
    if (!turn.feedback) problems.push(`${turn.time_elapsed}: no feedback on the response`);
  });
  turns.forEach((turn) => {
    const count = turn.response_options?.length ?? 0;
    if (turn.scenario_status === "ongoing" && (count < 3 || count > 4)) {
      problems.push(`${turn.time_elapsed}: ${count} response options (expected 3–4)`);
    }
  });
  if (turns.length > 1 && turns.every((turn, i) => i === 0 || turn.hours_elapsed > turns[i - 1].hours_elapsed) === false) {
    problems.push("Clock did not move forward every turn");
  }

  // Safety: no indoor fuel-burning heat or generators in advice.
  const advice = turns.flatMap((turn) => [
    ...(turn.feedback ? [...turn.feedback.covered, ...turn.feedback.consider, turn.feedback.why] : []),
    ...turn.suggested_actions,
  ]);
  if (result.report) advice.push(...result.report.do_better);
  for (const flagged of unsafeAdvice(advice)) problems.push(`SAFETY (review) ${flagged}`);

  // Debrief: present, answers the two questions, no verdict.
  if (result.report) {
    if (!result.report.need_to_know.length) problems.push("Debrief has no 'what you need to know'");
    if (!result.report.do_better.length) problems.push("Debrief has no 'what you can do better'");
    const text = [result.report.summary, ...result.report.need_to_know, ...result.report.do_better, ...result.report.went_well].join(" ");
    if (VERDICT.test(text)) problems.push(`Debrief uses grading language: "${text.match(VERDICT)![0]}"`);
  } else if (turns.at(-1)?.scenario_status !== "complete") {
    result.notes.push(`Stopped at ${turns.at(-1)?.time_elapsed ?? "the start"} (EVAL_TURNS=${MAX_TURNS}); no debrief`);
  }

  const alerts = turns.flatMap((turn) => turn.critical_alerts);
  result.notes.push(
    `${turns.length} turns, reached ${turns.at(-1)?.time_elapsed ?? "Hour 0"}, ${alerts.length} attention items`,
    `Average turn latency ${Math.round(result.turns.reduce((sum, t) => sum + t.ms, 0) / Math.max(1, result.turns.length))} ms`,
  );
}

const list = (items: string[]) => (items.length ? items.map((item) => `- ${item}`).join("\n") : "- (none)");

function reportMarkdown({ household, baseline, turns, report, problems, notes }: Result) {
  const out = [
    `# ${household.persona}`,
    "",
    `**What this household tests:** ${household.tests}`,
    "",
    `## Checks`,
    "",
    problems.length ? list(problems.map((p) => `❌ ${p}`)) : "- ✅ All automatic checks passed",
    "",
    list(notes),
    "",
    "## What the scenario engine received",
    "",
    "```text",
    baseline,
    "```",
  ];
  turns.forEach(({ sent, turn, error }, index) => {
    out.push("", `## ${turn?.time_elapsed ?? `Call ${index + 1}`}`, "");
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
      report.summary,
      "",
      "**What you need to know**",
      list(report.need_to_know),
      "",
      "**What you can do better**",
      list(report.do_better),
      "",
      "**What went well**",
      list(report.went_well),
    );
  }
  return out.join("\n") + "\n";
}

const households = TEST_HOUSEHOLDS.filter((household) => !ONLY || ONLY.includes(household.id));
const results: Result[] = [];

describe(`test households against ${BASE_URL}`, () => {
  afterAll(() => {
    if (!results.length) return;
    const rows = results.map(
      (r) => `| [${r.household.persona}](${r.household.id}.md) | ${r.problems.length ? `❌ ${r.problems.length}` : "✅"} | ${r.notes.join("; ")} |`,
    );
    const problems = results.flatMap((r) => r.problems.map((p) => `- **${r.household.id}:** ${p}`));
    writeFileSync(
      path.join(outDir, "summary.md"),
      [
        `# Household evaluation, ${new Date().toISOString()}`,
        "",
        `Server ${BASE_URL}; model ${SETTINGS ? `${SETTINGS.provider}/${SETTINGS.model ?? "default"}` : "server default"}; up to ${MAX_TURNS} turns; responses chosen "${CHOOSE}".`,
        "",
        "| Household | Checks | Notes |",
        "| --- | --- | --- |",
        ...rows,
        "",
        "## Problems",
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
    expect(result.problems.filter((p) => p.startsWith("PRIVACY") || p.includes("failed"))).toEqual([]);
  });
});
