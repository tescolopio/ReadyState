/**
 * Runs the eval-only factual-consistency judge (G11) over the case set in
 * scripts/eval/factual/, then scores it against the manual labels. Opt-in:
 * `EVAL_FACTUAL=1 npm run eval -- scripts/eval/factual.eval.ts`. It calls
 * the provider directly with the server's env key, not the ReadyState server.
 *
 * A hard token budget (EVAL_JUDGE_BUDGET, default 25,000 input and output
 * tokens) stops it before any call that could exceed it; a failed call
 * counts at its full allowance, since its usage isn't reported.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { describe, expect, it } from "vitest";

import { resolveModel } from "@/lib/providers";

import { BATCHES } from "./factual/cases";
import { MAX_OUTPUT_TOKENS, batchPrompt, estimateInputTokens, formProblems, judgeBatch, type BatchRun } from "./factual/judge";
import { score, summarize, type ScoredCase } from "./factual/score";

const ENABLED = process.env.EVAL_FACTUAL === "1";
const BUDGET = Number(process.env.EVAL_JUDGE_BUDGET ?? 25_000);
/** Groq's limit is per minute; a pause between calls keeps a call from being refused for the previous one. */
const PAUSE_MS = 62_000;
const outDir = path.join("eval-results", `${new Date().toISOString().replace(/[:.]/g, "-")}-factual`);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe.skipIf(!ENABLED)("G11 factual-consistency judge, eval only", () => {
  it("judges the case set within the token budget", async () => {
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
    for (const batch of BATCHES) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const allowance = estimateInputTokens(batchPrompt(batch)) + MAX_OUTPUT_TOKENS;
        if (spent + allowance > BUDGET) {
          skipped.push(`${batch.name} (attempt ${attempt}): would exceed the ${BUDGET}-token budget at ${spent} spent`);
          break;
        }
        if (runs.length) await sleep(PAUSE_MS);
        const callsBefore = providerCalls;
        const run = await judgeBatch(model, batch, MAX_OUTPUT_TOKENS);
        run.attempts = attempt;
        const used = run.usage.inputTokens + run.usage.outputTokens;
        // A failed call's usage isn't reported, so it counts at its full allowance for every provider call it made.
        spent += run.error ? allowance * Math.max(1, providerCalls - callsBefore) : used;
        runs.push({ ...run, providerCalls: providerCalls - callsBefore } as BatchRun & { providerCalls: number });
        if (!run.error) break;
      }
    }

    const judged = runs.filter((run) => run.judgment);
    const scored = score(judged.map((run) => run.judgment!));
    const summary = summarize(scored);
    const usage = runs.reduce((total, run) => ({ input: total.input + run.usage.inputTokens, output: total.output + run.usage.outputTokens }), { input: 0, output: 0 });
    const form = judged.flatMap((run) => formProblems(BATCHES.find((batch) => batch.name === run.batch)!, run.judgment!));

    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      path.join(outDir, "factual-judge.json"),
      JSON.stringify({ model: `${resolved.provider}/${modelId}`, budget: BUDGET, spentForBudget: spent, usage, providerCalls, skipped, form, runs, scored, summary }, null, 2),
    );
    writeFileSync(path.join(outDir, "factual-judge.md"), report({ model: `${resolved.provider}/${modelId}`, runs, scored, summary, usage, providerCalls, skipped, form, spent }));
    console.log(`Factual judge report written to ${path.resolve(outDir)}`);
    expect(spent).toBeLessThanOrEqual(BUDGET);
  });
});

const cell = (text = "") => text.replace(/\|/g, "\\|").replace(/\s+/g, " ");

function report({
  model,
  runs,
  scored,
  summary,
  usage,
  providerCalls,
  skipped,
  form,
  spent,
}: {
  model: string;
  runs: BatchRun[];
  scored: ScoredCase[];
  summary: ReturnType<typeof summarize>;
  usage: { input: number; output: number };
  providerCalls: number;
  skipped: string[];
  form: string[];
  spent: number;
}) {
  const list = (cases: ScoredCase[]) => (cases.length ? cases.map((c) => `- ${c.id} (${c.type}, ${c.split}): ${c.verdict ?? "none"}. ${c.explanation ?? ""}`).join("\n") : "- none");
  return [
    "# G11 factual-consistency judge (eval only)",
    "",
    `Model ${model}. ${runs.length} judge call(s), ${providerCalls} provider call(s) including SDK retries; ${usage.input} input / ${usage.output} output tokens (${spent} counted against the budget).`,
    ...(skipped.length ? ["", "**Skipped for the budget:**", ...skipped.map((s) => `- ${s}`)] : []),
    "",
    "| Call | Attempt | Result | Input | Output | ms |",
    "| --- | --- | --- | --- | --- | --- |",
    ...runs.map((run) => `| ${run.batch} | ${run.attempts} | ${run.error ?? "verdicts"} | ${run.usage.inputTokens} | ${run.usage.outputTokens} | ${run.ms} |`),
    "",
    `**Defects:** ${summary.caught} of ${summary.defects} caught. **Accurate text:** ${summary.accepted} of ${summary.accurate} accepted. Exact verdict matches: ${summary.exact}.`,
    "",
    "**Missed defects (judged supported):**",
    list(summary.missed),
    "",
    "**False positives (accurate text judged contradicted or unsupported):**",
    list(summary.falsePositives),
    "",
    "**Unclear verdicts on labeled cases:**",
    list(summary.unclear),
    "",
    "**No verdict:**",
    list(summary.noVerdict),
    "",
    "**Ambiguous cases (not scored):**",
    list(summary.ambiguous),
    "",
    "**Story-facts conflicts reported:**",
    ...runs.map((run) => `- ${run.batch}: ${run.judgment ? (run.judgment.story_facts_conflicts.length ? run.judgment.story_facts_conflicts.map((c) => `"${c.note_text}" vs ${c.log_references.join(", ")}: ${c.explanation}`).join("; ") : "none") : "(no judgment)"}`),
    "",
    "**Form problems:**",
    form.length ? form.map((f) => `- ${f}`).join("\n") : "- none",
    "",
    "| Case | Split | Kind | Type | Expected | Verdict | Outcome | Basis matches | Forecast flagged | Evidence | Explanation |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...scored.map(
      (c) =>
        `| ${c.id} | ${c.split} | ${c.kind} | ${cell(c.type)} | ${c.expected ?? "-"} | ${c.verdict ?? "-"} | ${c.outcome} | ${c.basisMatches ?? "-"} | ${c.forecastFlagged ?? "-"} | ${cell(c.evidence?.join(", "))} | ${cell(c.explanation)} |`,
    ),
    "",
  ].join("\n");
}
