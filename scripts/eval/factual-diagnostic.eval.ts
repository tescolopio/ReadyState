/**
 * The G11 provider diagnostic (scripts/eval/factual/diagnostic.ts): three
 * claim calls with synthetic content, run one at a time with no retries, to
 * find what kind of failure the claim calls hit. It measures call
 * completion, not factual accuracy. Opt-in:
 *
 *   EVAL_DIAGNOSTIC=1 npm run eval -- scripts/eval/factual-diagnostic.eval.ts
 *
 * EVAL_DIAGNOSTIC_DRY_RUN=1 prints the plan without any model call. It stops
 * before any call whose allowance would take the charge past the cap, and
 * after a failure that would also break the remaining calls. A failed call
 * reports no usage, so it is charged at its full allowance: the charge is
 * budget accounting, not measured usage.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { describe, expect, it } from "vitest";

import { resolveModel } from "@/lib/providers";

import { DIAGNOSTIC_CAP, diagnosticCalls, stopsTheRun } from "./factual/diagnostic";
import { judgeClaimsText, type CallRun } from "./factual/judge";

const ENABLED = process.env.EVAL_DIAGNOSTIC === "1";
const DRY_RUN = process.env.EVAL_DIAGNOSTIC_DRY_RUN === "1";
const PAUSE_MS = 62_000;
const outDir = path.join("eval-results", `${new Date().toISOString().replace(/[:.]/g, "-")}-diagnostic`);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe.skipIf(!ENABLED)("G11 provider diagnostic, call completion only", () => {
  it("runs D1–D3 within the cap", async () => {
    const calls = diagnosticCalls();
    process.stdout.write(`\nDiagnostic plan: ${calls.map((c) => `${c.name} ≤${c.allowance}`).join(", ")}; worst case ${calls.reduce((s, c) => s + c.allowance, 0)} of ${DIAGNOSTIC_CAP}.\n`);
    if (DRY_RUN) return;

    if (!process.env.GROQ_API_KEY) {
      try {
        process.loadEnvFile(".env.local");
      } catch {
        // Reported below as an unresolved model.
      }
    }
    const resolved = resolveModel("self-hosted", { provider: "groq" });
    if (!resolved.ok) throw new Error(`No model: ${resolved.error}`);
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
    const runs: (CallRun<unknown> & { varies: string; charged: number })[] = [];
    const notRun: string[] = [];
    let charged = 0;
    let stopped: string | undefined;
    for (const [i, planned] of calls.entries()) {
      if (stopped) {
        notRun.push(`${planned.name}: stopped early (${stopped})`);
        continue;
      }
      if (charged + planned.allowance > DIAGNOSTIC_CAP) {
        notRun.push(`${planned.name}: its allowance would take the charge past ${DIAGNOSTIC_CAP} (at ${charged})`);
        continue;
      }
      if (runs.length) await sleep(PAUSE_MS);
      const before = providerCalls;
      const run = await judgeClaimsText(model, planned.name, planned.content, 0);
      run.providerCalls = providerCalls - before;
      const charge = run.status === "provider failure" ? planned.allowance : run.usage.inputTokens + run.usage.outputTokens;
      charged += charge;
      // The judgment itself isn't kept: this measures completion, not accuracy.
      runs.push({ ...run, result: undefined, varies: planned.varies, charged: charge });
      stopped = stopsTheRun(run, i === 0);
    }

    const reported = runs.reduce((sum, run) => sum + run.usage.inputTokens + run.usage.outputTokens, 0);
    const meta = { model: `${resolved.provider}/${modelId}`, revision: revision(), cap: DIAGNOSTIC_CAP, charged, reported, providerCalls, elapsedMs: Date.now() - started, stopped, notRun };
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "diagnostic.json"), JSON.stringify({ ...meta, runs }, null, 2));
    writeFileSync(
      path.join(outDir, "diagnostic.md"),
      [
        "# G11 provider diagnostic (call completion, not factual accuracy)",
        "",
        `Model ${meta.model}, code ${meta.revision}. ${runs.length} call(s), ${providerCalls} provider call(s), no retries; ${Math.round(meta.elapsedMs / 1000)} s elapsed.`,
        "",
        `**Tokens:** ${reported} reported; ${charged} conservatively charged against the ${DIAGNOSTIC_CAP} cap (a failed call is charged at its full allowance; the charge is budget accounting, not measured usage).`,
        "",
        "| Call | Varies | Status | Failure kind | Error code | Finish reason | Schema valid | Schema issues | Failed generation | Input | Output | Charged | ms |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ...runs.map(
          (run) =>
            `| ${run.name} | ${run.varies} | ${run.status} | ${run.error ?? ""} | ${run.errorCode ?? ""} | ${run.finishReason ?? ""} | ${run.schemaValid ?? ""} | ${(run.schemaIssues ?? []).join(", ")} | ${run.failedGeneration ? `${run.failedGeneration.length} chars, JSON ${run.failedGeneration.json}, issues ${run.failedGeneration.schemaIssues.join(", ") || "none"}` : ""} | ${run.usage.inputTokens} | ${run.usage.outputTokens} | ${run.charged} | ${run.ms} |`,
        ),
        "",
        ...(notRun.length ? ["**Not run:**", ...notRun.map((n) => `- ${n}`), ""] : []),
      ].join("\n"),
    );
    process.stdout.write(`Diagnostic report written to ${path.resolve(outDir)}\n`);
    expect(charged).toBeLessThanOrEqual(DIAGNOSTIC_CAP);
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
