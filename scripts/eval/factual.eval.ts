/**
 * Runs the eval-only factual-consistency judge (G11) over the case set in
 * scripts/eval/factual/, validates each judgment against the contract and
 * scores it against the manual labels. Opt-in:
 *
 *   EVAL_FACTUAL=1 EVAL_FACTUAL_SET=development npm run eval -- scripts/eval/factual.eval.ts
 *
 * EVAL_FACTUAL_SET is development, reserved or all (default development).
 * EVAL_FACTUAL_DRY_RUN=1 prints the plan and its token estimate without any
 * model call. It calls the provider directly with the server's env key, not
 * the ReadyState server. A hard token budget (EVAL_JUDGE_BUDGET, default
 * 25,000 input and output tokens) stops it before any call that could exceed
 * it; a failed call counts at its full allowance, since its usage isn't
 * reported.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { describe, expect, it } from "vitest";

import { resolveModel } from "@/lib/providers";

import { BATCHES, type Batch } from "./factual/cases";
import { MAX_OUTPUT_TOKENS, batchPrompt, checkNote, estimateInputTokens, judgeBatch, validate, type BatchRun, type NoteCheckResult, type ValidatedClaim } from "./factual/judge";
import { score, summarize, type ScoredCase } from "./factual/score";

const ENABLED = process.env.EVAL_FACTUAL === "1";
const DRY_RUN = process.env.EVAL_FACTUAL_DRY_RUN === "1";
const SET = process.env.EVAL_FACTUAL_SET ?? "development";
const BUDGET = Number(process.env.EVAL_JUDGE_BUDGET ?? 25_000);
/** Groq's limit is per minute; a pause between calls keeps a call from being refused for the previous one. */
const PAUSE_MS = 62_000;
const outDir = path.join("eval-results", `${new Date().toISOString().replace(/[:.]/g, "-")}-factual`);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The batches a set runs, and the most each call may use. */
export function plan(set: string) {
  const batches = BATCHES.filter((batch) => set === "all" || batch.set === set);
  const calls = batches.map((batch) => ({ batch: batch.name, allowance: estimateInputTokens(batchPrompt(batch).text) + MAX_OUTPUT_TOKENS }));
  return { batches, calls, worstCase: calls.reduce((sum, call) => sum + call.allowance, 0) };
}

describe.skipIf(!ENABLED)("G11 factual-consistency judge, eval only", () => {
  it("judges the case set within the token budget", async () => {
    const { batches, calls, worstCase } = plan(SET);
    // Written directly: the test runner hides console output from passing tests.
    process.stdout.write(`\nPlan for ${SET}: ${calls.map((c) => `${c.batch} ≤${c.allowance}`).join(", ")}; worst case ${worstCase} of a ${BUDGET}-token budget.\n`);
    if (DRY_RUN) return;

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

    const runs: BatchRun[] = [];
    const skipped: string[] = [];
    let spent = 0;
    for (const batch of batches) {
      const allowance = estimateInputTokens(batchPrompt(batch).text) + MAX_OUTPUT_TOKENS;
      for (let attempt = 1; attempt <= 2; attempt++) {
        if (spent + allowance > BUDGET) {
          skipped.push(`${batch.name} (attempt ${attempt}): would exceed the budget at ${spent} spent`);
          break;
        }
        if (runs.length) await sleep(PAUSE_MS);
        const before = providerCalls;
        const run = await judgeBatch(model, batch, MAX_OUTPUT_TOKENS);
        run.attempts = attempt;
        run.providerCalls = providerCalls - before;
        spent += run.error ? allowance * Math.max(1, run.providerCalls) : run.usage.inputTokens + run.usage.outputTokens;
        runs.push(run);
        if (!run.error) break;
      }
    }

    const judged = runs.filter((run) => run.judgment).map((run) => ({ run, batch: batches.find((b) => b.name === run.batch)! }));
    const validated: ValidatedClaim[] = judged.flatMap(({ batch, run }) => validate(batch, run.judgment!).claims);
    const notes = judged.map(({ batch, run }) => ({ batch: batch.name, result: checkNote(batch, run.judgment!) })).filter((n) => n.result);
    const scored = score(validated).filter((c) => batches.some((b) => b.cases.some((x) => x.id === c.id)));
    const usage = runs.reduce((total, run) => ({ input: total.input + run.usage.inputTokens, output: total.output + run.usage.outputTokens }), { input: 0, output: 0 });

    mkdirSync(outDir, { recursive: true });
    const meta = { model: `${resolved.provider}/${modelId}`, set: SET, budget: BUDGET, spent, usage, providerCalls, skipped };
    writeFileSync(path.join(outDir, "factual-judge.json"), JSON.stringify({ ...meta, runs, validated, notes, scored }, null, 2));
    writeFileSync(path.join(outDir, "factual-judge.md"), report(meta, runs, scored, notes as { batch: string; result: NoteCheckResult }[], batches));
    console.log(`Factual judge report written to ${path.resolve(outDir)}`);
    expect(spent).toBeLessThanOrEqual(BUDGET);
  });
});

const cell = (text = "") => text.replace(/\|/g, "\\|").replace(/\s+/g, " ");
const ids = (cases: ScoredCase[]) => (cases.length ? cases.map((c) => `${c.id} (${c.type})`).join("; ") : "none");

function report(
  meta: { model: string; set: string; spent: number; usage: { input: number; output: number }; providerCalls: number; skipped: string[] },
  runs: BatchRun[],
  scored: ScoredCase[],
  notes: { batch: string; result: NoteCheckResult }[],
  batches: Batch[],
) {
  const sets = [...new Set(batches.map((b) => b.set))];
  return [
    "# G11 factual-consistency judge (eval only)",
    "",
    `Model ${meta.model}, set ${meta.set}. ${runs.length} judge call(s), ${meta.providerCalls} provider call(s) including SDK retries; ${meta.usage.input} input / ${meta.usage.output} output tokens (${meta.spent} counted against the budget).`,
    ...(meta.skipped.length ? ["", "**Skipped for the budget:**", ...meta.skipped.map((s) => `- ${s}`)] : []),
    "",
    "| Call | Attempt | Result | Input | Output | ms | Provider calls |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...runs.map((run) => `| ${run.batch} | ${run.attempts} | ${run.error ?? "judgment"} | ${run.usage.inputTokens} | ${run.usage.outputTokens} | ${run.ms} | ${run.providerCalls ?? "?"} |`),
    "",
    ...sets.flatMap((set) => {
      const s = summarize(scored, set);
      return [
        `## ${set}`,
        "",
        "| Result | Count | Cases |",
        "| --- | --- | --- |",
        `| Defects detected | ${s.detected.length} of ${s.defects} | ${ids(s.detected)} |`,
        `| …of which misclassified (contradicted vs unsupported) | ${s.misclassified.length} | ${ids(s.misclassified)} |`,
        `| Missed defects (judged supported) | ${s.missed.length} | ${ids(s.missed)} |`,
        `| Accurate text accepted | ${s.accepted.length} of ${s.accurate} | ${ids(s.accepted)} |`,
        `| False positives (accurate text rejected) | ${s.falsePositives.length} | ${ids(s.falsePositives)} |`,
        `| Unclear on labeled cases | ${s.unclear.length} | ${ids(s.unclear)} |`,
        `| Invalid results (contract broken) | ${s.invalid.length} | ${ids(s.invalid)} |`,
        `| Boundary violations (counted as unsupported) | ${s.boundaryViolations.length} | ${ids(s.boundaryViolations)} |`,
        `| Mixed claims: false detail flagged | ${s.mixed.filter((c) => c.falseDetailFlagged).length} of ${s.mixed.length} | ${s.mixed.map((c) => `${c.id}: ${c.falseDetailFlagged ?? c.outcome}`).join("; ")} |`,
        `| Ambiguous (not scored) | ${s.ambiguous.length} | ${s.ambiguous.map((c) => `${c.id}: ${c.verdict ?? "invalid"}`).join("; ")} |`,
        "",
      ];
    }),
    "## Note checks",
    "",
    ...notes.map(({ batch, result }) => `- ${batch}: corruption ${result.corruptionReported === undefined ? "none planted" : result.corruptionReported ? "reported" : "**not reported**"}; unchecked lines ${result.unchecked.join(", ") || "none"}; false alarms ${result.falseAlarms.join(", ") || "none"}`),
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
