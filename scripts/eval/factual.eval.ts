/**
 * Runs the eval-only factual-consistency judge (G11): claim calls and
 * separate note checks over the case set in scripts/eval/factual/, validated
 * against the contract and scored against the manual labels. Opt-in:
 *
 *   EVAL_FACTUAL=1 EVAL_FACTUAL_SET=development npm run eval -- scripts/eval/factual.eval.ts
 *
 * EVAL_FACTUAL_SET is development, reserved, all, or pilot (default development).
 * The pilot is the four defects the first run missed and their accurate
 * rewrites, in four two-claim calls, with no note check (cases.ts PILOT_CALLS).
 * EVAL_FACTUAL_DRY_RUN=1 prints the plan and its token allowance without any
 * model call. It calls the provider directly with the server's env key, not
 * the ReadyState server. Claim batches are split to at most two claims a call
 * (scripts/eval/factual/run.ts). A hard budget (EVAL_JUDGE_BUDGET, default
 * 25,000) stops it before any call whose allowance could exceed it. There are
 * no retries, the SDK's included, unless EVAL_FACTUAL_ATTEMPTS is above 1. A
 * call without reported usage is charged at its full allowance: the charge is
 * budget accounting, not measured usage, and the report keeps the two apart.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";
import { describe, expect, it } from "vitest";

import { resolveModel } from "@/lib/providers";

import { BATCHES, NOTE_CHECKS, pilotBatches } from "./factual/cases";
import {
  MAX_OUTPUT_TOKENS,
  NOTE_INSTRUCTIONS,
  NOTE_MAX_OUTPUT_TOKENS,
  batchPrompt,
  checkNote,
  estimateInputTokens,
  judgeBatch,
  judgeNote,
  notePrompt,
  type CallRun,
  type CallStatus,
  type NoteCheckResult,
} from "./factual/judge";
import { collectResults, runCalls, splitBatches } from "./factual/run";
import { score, summarize, type ScoredCase } from "./factual/score";

const ENABLED = process.env.EVAL_FACTUAL === "1";
const DRY_RUN = process.env.EVAL_FACTUAL_DRY_RUN === "1";
const SET = process.env.EVAL_FACTUAL_SET ?? "development";
const BUDGET = Number(process.env.EVAL_JUDGE_BUDGET ?? 25_000);
const ATTEMPTS = Number(process.env.EVAL_FACTUAL_ATTEMPTS ?? 1);
/** Groq's limit is per minute; a pause between calls keeps a call from being refused for the previous one. */
const PAUSE_MS = 62_000;
const outDir = path.join("eval-results", `${new Date().toISOString().replace(/[:.]/g, "-")}-factual`);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface PlannedCall {
  name: string;
  allowance: number;
  run: (model: LanguageModel) => Promise<CallRun<unknown>>;
}

const inSet = (set: string) => (s: string) => set === "all" || s === set;

/** The claim calls a set makes: its batches split to at most two claims each. */
export const claimBatches = (set: string) => (set === "pilot" ? pilotBatches() : splitBatches(BATCHES.filter((batch) => inSet(set)(batch.set))));

/** The calls a set makes, in order, and the most each may use. SDK retries are off: every provider call is one the plan counts. */
export function plan(set: string): PlannedCall[] {
  return [
    ...claimBatches(set).map((batch) => ({
      name: batch.name,
      allowance: estimateInputTokens(batchPrompt(batch).text) + MAX_OUTPUT_TOKENS,
      run: (model: LanguageModel) => judgeBatch(model, batch, 0),
    })),
    ...NOTE_CHECKS.filter((check) => set !== "pilot" && inSet(set)(check.set)).map((check) => ({
      name: check.name,
      allowance: estimateInputTokens(notePrompt(check).text, NOTE_INSTRUCTIONS) + NOTE_MAX_OUTPUT_TOKENS,
      run: (model: LanguageModel) => judgeNote(model, check, 0),
    })),
  ];
}

describe.skipIf(!ENABLED)("G11 factual-consistency judge, eval only", () => {
  it("judges the case set within the token budget", async () => {
    const calls = plan(SET);
    const worstCase = calls.reduce((sum, c) => sum + c.allowance, 0);
    // Written directly: the test runner hides console output from passing tests.
    process.stdout.write(
      `\nPlan for ${SET}: ${calls.length} calls, ${ATTEMPTS} attempt(s) each: ${calls.map((c) => `${c.name} ≤${c.allowance}`).join(", ")}; worst case ${worstCase * ATTEMPTS} of a ${BUDGET}-token budget.\n`,
    );
    if (DRY_RUN) return;
    // Preflight: every call charged at its full allowance must fit, or nothing runs.
    if (worstCase * ATTEMPTS > BUDGET) throw new Error(`Worst case ${worstCase * ATTEMPTS} exceeds the ${BUDGET}-token budget; no calls made.`);

    if (!process.env.GROQ_API_KEY) {
      try {
        process.loadEnvFile(".env.local");
      } catch {
        // Reported below as an unresolved model.
      }
    }
    const resolved = resolveModel("self-hosted", { provider: (process.env.EVAL_PROVIDER as "groq") ?? "groq", model: process.env.EVAL_MODEL });
    if (!resolved.ok) throw new Error(`No judge model: ${resolved.error}`);
    let providerCalls = 0;
    const counting: LanguageModelMiddleware = {
      specificationVersion: "v4",
      wrapGenerate: async ({ doGenerate }) => {
        providerCalls++;
        return doGenerate();
      },
    };
    const model = typeof resolved.model === "string" ? resolved.model : wrapLanguageModel({ model: resolved.model, middleware: counting });
    const modelId = typeof resolved.model === "string" ? resolved.model : resolved.model.modelId;

    const started = Date.now();
    const { runs, charged } = await runCalls(
      calls.map((planned) => ({
        name: planned.name,
        allowance: planned.allowance,
        run: async () => {
          const before = providerCalls;
          const run = await planned.run(model);
          run.providerCalls = providerCalls - before;
          return run;
        },
      })),
      { budget: BUDGET, attempts: ATTEMPTS, pause: () => sleep(PAUSE_MS) },
    );

    // Each case's call outcome: the last attempt of its batch. A failed batch leaves only its own cases missing.
    const lastRun = (name: string) => runs.filter((run) => run.name === name).at(-1)!;
    const { status, validated } = collectResults(claimBatches(SET), runs);
    const notes = NOTE_CHECKS.filter((check) => calls.some((c) => c.name === check.name)).map((check) => {
      const run = lastRun(check.name);
      return { name: check.name, status: run.status, result: run.status === "completed" ? checkNote(check, run.result as Parameters<typeof checkNote>[1]) : undefined };
    });
    const scored = score(validated, status);
    const reported = runs.reduce((total, run) => ({ input: total.input + run.usage.inputTokens, output: total.output + run.usage.outputTokens }), { input: 0, output: 0 });

    mkdirSync(outDir, { recursive: true });
    const meta = { model: `${resolved.provider}/${modelId}`, set: SET, budget: BUDGET, charged, reported, providerCalls, elapsedMs: Date.now() - started, revision: revision() };
    writeFileSync(path.join(outDir, "factual-judge.json"), JSON.stringify({ ...meta, runs, validated, notes, scored }, null, 2));
    writeFileSync(path.join(outDir, "factual-judge.md"), report(meta, runs, scored, notes));
    process.stdout.write(`Factual judge report written to ${path.resolve(outDir)}\n`);
    expect(charged).toBeLessThanOrEqual(BUDGET);
  });
});

function revision() {
  try {
    const commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim() !== "";
    return `${commit}${dirty ? " (uncommitted changes)" : ""}`;
  } catch {
    return "unknown";
  }
}

const cell = (text = "") => text.replace(/\|/g, "\\|").replace(/\s+/g, " ");
const ids = (cases: ScoredCase[]) => (cases.length ? cases.map((c) => `${c.id} (${c.type})`).join("; ") : "none");

function report(
  meta: { model: string; set: string; charged: number; reported: { input: number; output: number }; providerCalls: number; elapsedMs: number; revision: string },
  runs: CallRun<unknown>[],
  scored: ScoredCase[],
  notes: { name: string; status: CallStatus; result?: NoteCheckResult }[],
) {
  const sets = [...new Set(scored.map((c) => c.set))];
  return [
    "# G11 factual-consistency judge (eval only)",
    "",
    `Model ${meta.model}, set ${meta.set}, code ${meta.revision}. ${runs.length} call attempt(s), ${meta.providerCalls} provider call(s) including SDK retries; ${Math.round(meta.elapsedMs / 1000)} s elapsed.`,
    "",
    `**Tokens:** ${meta.reported.input + meta.reported.output} reported (${meta.reported.input} input, ${meta.reported.output} output); ${meta.charged} conservatively charged against the budget. The charge is budget accounting, not measured usage: a call without reported usage is charged at its full allowance.`,
    "",
    "| Call | Attempt | Status | Failure | Input | Output | ms | Provider calls |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...runs.map((run) => `| ${run.name} | ${run.attempts} | ${run.status} | ${run.error ?? ""} | ${run.usage.inputTokens} | ${run.usage.outputTokens} | ${run.ms} | ${run.providerCalls ?? "?"} |`),
    "",
    ...sets.flatMap((set) => {
      const s = summarize(scored, set);
      return [
        `## ${set}`,
        "",
        `**Provider completion:** ${runs.filter((run) => run.status === "completed").length} of ${runs.length} call attempt(s) returned a tool call.`,
        "",
        `**Valid-result coverage of ${s.cases} cases:** provider failures ${s.coverage.providerFailures.length}; not run ${s.coverage.notRun.length}; invalid responses ${s.coverage.invalidResponses.length}; valid judgments ${s.coverage.validJudgments.length}.`,
        "",
        `**Overall, over every labeled case (missing and invalid results count as failures):** defects whose whole false detail a non-supported assertion quotes ${s.overall.defectsDetectedOnDetail} (necessary, not sufficient: whether each rejection challenges that detail is confirmed by hand, from the review table below); accurate texts accepted ${s.overall.accurateAccepted}. These measure judgments against the labels, not call completion.`,
        "",
        "**Valid judgments:**",
        "",
        "| Result | Count | Cases |",
        "| --- | --- | --- |",
        `| Defects whose whole false detail is quoted in a rejection (pending manual confirmation) | ${s.detected.length} | ${ids(s.detected)} |`,
        `| Defects detected on another detail | ${s.detectedOnAnotherDetail.length} | ${ids(s.detectedOnAnotherDetail)} |`,
        `| …misclassified (contradicted vs unsupported) | ${s.misclassified.length} | ${ids(s.misclassified)} |`,
        `| Missed defects (judged supported) | ${s.missed.length} | ${ids(s.missed)} |`,
        `| False positives (accurate text rejected) | ${s.falsePositives.length} | ${ids(s.falsePositives)} |`,
        `| Unclear on labeled cases | ${s.unclear.length} | ${ids(s.unclear)} |`,
        `| Boundary violations (counted as unsupported) | ${s.boundaryViolations.length} | ${ids(s.boundaryViolations)} |`,
        `| Ambiguous (not scored) | ${s.ambiguous.length} | ${s.ambiguous.map((c) => `${c.id}: ${c.verdict}`).join("; ")} |`,
        "",
        "**Invalid responses:**",
        ...(s.coverage.invalidResponses.length ? s.coverage.invalidResponses.map((c) => `- ${c.id}: ${c.invalid.join("; ")}`) : ["- none"]),
        "",
      ];
    }),
    "## Note checks",
    "",
    ...notes.map(({ name, status, result }) =>
      result
        ? `- ${name}: planted line ${result.planted.detected ? "**detected**" : "not detected"} (marked inconsistent ${result.planted.markedInconsistent}, on the planted detail ${result.planted.onDetail}, refuting line quoted correctly ${result.planted.refutedCorrectly}); false alarms ${result.falseAlarms.join(", ") || "none"}; unchecked ${result.unchecked.join(", ") || "none"}; invalid quotations ${result.invalid.join("; ") || "none"}`
        : `- ${name}: ${status}`,
    ),
    "",
    "## Rejected assertions on defects, for manual review",
    "",
    "Does each rejection challenge the false detail itself, rather than another part of the quote?",
    "",
    "| Case | False detail | Rejected assertion | Verdict | Evidence cited | Missing | Explanation |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...scored
      .filter((c) => c.review)
      .flatMap((c) =>
        c.review!.rejected.length
          ? c.review!.rejected.map(
              (r) =>
                `| ${c.id} | ${cell(c.review!.falseDetail)} | ${cell(r.quote)} | ${r.verdict} | ${cell(r.evidence.map((e) => `[${e.ref}] ${e.quote}`).join("; "))} | ${cell(r.missing)} | ${cell(c.explanation)} |`,
            )
          : [`| ${c.id} | ${cell(c.review!.falseDetail)} | (none rejected) | | | | ${cell(c.explanation)} |`],
      ),
    "",
    "## Every case",
    "",
    "| Case | Set | Household | Kind | Type | Expected | Verdict | Outcome | Invalid | Boundary | Explanation |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...scored.map(
      (c) =>
        `| ${c.id} | ${c.set} | ${c.household} | ${c.kind} | ${cell(c.type)} | ${c.expected ?? "-"} | ${c.verdict ?? "-"} | ${c.outcome} | ${cell(c.invalid.join("; "))} | ${cell(c.boundaryViolations.join("; "))} | ${cell(c.explanation)} |`,
    ),
    "",
  ].join("\n");
}
