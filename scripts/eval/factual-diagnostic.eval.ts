/**
 * The G11 provider diagnostic (scripts/eval/factual/diagnostic.ts): runs
 * CURRENT_RUN's synthetic claim calls one at a time with no retries, under its
 * cap. Now the third run, D3 with a 4,000-token output limit (6,500 cap); the
 * first (D1–D3, 16,000) is commit 722c648 and the second (D1 and D3, kind as
 * free text, 10,000) d8080a2. It measures call completion and local
 * validation, separately; not reliability or factual accuracy. Opt-in:
 *
 *   EVAL_DIAGNOSTIC=1 npm run eval -- scripts/eval/factual-diagnostic.eval.ts
 *
 * EVAL_DIAGNOSTIC_DRY_RUN=1 prints the plan without any model call. It stops
 * before any call whose allowance would take the charge past the cap, and
 * after a failure that would also break the remaining calls. A call without
 * reported usage is charged at its full allowance: the charge is budget
 * accounting, not measured usage.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { describe, expect, it } from "vitest";

import { resolveModel } from "@/lib/providers";

import { CURRENT_RUN, TOKENS_PER_MINUTE, chargeFor, diagnosticCalls, stopsTheRun, validateDiagnostic } from "./factual/diagnostic";
import { judgeClaimsText, type CallRun, type ProviderJudgment } from "./factual/judge";

const ENABLED = process.env.EVAL_DIAGNOSTIC === "1";
const DRY_RUN = process.env.EVAL_DIAGNOSTIC_DRY_RUN === "1";
const PAUSE_MS = 62_000;
const outDir = path.join("eval-results", `${new Date().toISOString().replace(/[:.]/g, "-")}-diagnostic`);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe.skipIf(!ENABLED)("G11 provider diagnostic, call completion only", () => {
  it("runs the current diagnostic within its cap", async () => {
    const CAP = CURRENT_RUN.cap;
    const calls = diagnosticCalls(CURRENT_RUN.maxOutputTokens).filter((call) => CURRENT_RUN.calls.includes(call.name));
    for (const c of calls) if (c.allowance > TOKENS_PER_MINUTE) throw new Error(`${c.name}'s allowance ${c.allowance} exceeds the per-minute limit`);
    process.stdout.write(`\nDiagnostic plan (${CURRENT_RUN.name}): ${calls.map((c) => `${c.name} ≤${c.allowance} (output limit ${c.maxOutputTokens})`).join(", ")}; worst case ${calls.reduce((s, c) => s + c.allowance, 0)} of ${CAP}.\n`);
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
    type Validation = { claims: number; valid: number; problems: string[] };
    const runs: (CallRun<unknown> & { varies: string; charged: number; validation?: Validation })[] = [];
    const notRun: string[] = [];
    let charged = 0;
    let stopped: string | undefined;
    for (const [i, planned] of calls.entries()) {
      if (stopped) {
        notRun.push(`${planned.name}: stopped early (${stopped})`);
        continue;
      }
      if (charged + planned.allowance > CAP) {
        notRun.push(`${planned.name}: its allowance would take the charge past ${CAP} (at ${charged})`);
        continue;
      }
      if (runs.length) await sleep(PAUSE_MS);
      const before = providerCalls;
      const run = await judgeClaimsText(model, planned.name, planned.content, 0, planned.maxOutputTokens);
      run.providerCalls = providerCalls - before;
      const charge = chargeFor(run, planned.allowance);
      charged += charge;
      let validation: Validation | undefined;
      if (run.status === "completed") {
        const { claims } = validateDiagnostic(planned.content, run.result as ProviderJudgment);
        validation = { claims: claims.length, valid: claims.filter((c) => !c.invalid.length).length, problems: claims.flatMap((c) => c.invalid.map((p) => `${c.id} ${p}`)) };
      }
      // The judgment itself isn't kept: this measures completion and contract validity, not accuracy.
      runs.push({ ...run, result: undefined, varies: planned.varies, charged: charge, validation });
      stopped = stopsTheRun(run, i === 0);
    }

    const reported = runs.reduce((sum, run) => sum + run.usage.inputTokens + run.usage.outputTokens, 0);
    const meta = { model: `${resolved.provider}/${modelId}`, revision: revision(), cap: CAP, charged, reported, providerCalls, elapsedMs: Date.now() - started, stopped, notRun };
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "diagnostic.json"), JSON.stringify({ ...meta, runs }, null, 2));
    writeFileSync(
      path.join(outDir, "diagnostic.md"),
      [
        `# G11 provider diagnostic, ${CURRENT_RUN.name} (call completion and local validation, not factual accuracy)`,
        "",
        `Model ${meta.model}, code ${meta.revision}. ${runs.length} call(s), ${providerCalls} provider call(s), no retries; output limit ${CURRENT_RUN.maxOutputTokens}; ${Math.round(meta.elapsedMs / 1000)} s elapsed.`,
        "",
        `**Tokens:** ${reported} reported; ${charged} conservatively charged against the ${CAP} cap (a call without reported usage is charged at its full allowance; the charge is budget accounting, not measured usage).`,
        "",
        "## Provider completion",
        "",
        "| Call | Varies | Status | Failure kind | Error code | Finish reason | Failed generation | Input | Output | Charged | ms |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ...runs.map(
          (run) =>
            `| ${run.name} | ${run.varies} | ${run.status} | ${run.error ?? ""} | ${run.errorCode ?? ""} | ${run.finishReason ?? ""} | ${failedGeneration(run)} | ${run.usage.inputTokens} | ${run.usage.outputTokens} | ${run.charged} | ${run.ms} |`,
        ),
        "",
        "## Local validation (completed calls only)",
        "",
        "| Call | Full schema valid (kinds included) | Schema issues | Claims valid under the contract | Contract problems |",
        "| --- | --- | --- | --- | --- |",
        ...runs.map((run) =>
          run.validation
            ? `| ${run.name} | ${run.schemaValid} | ${(run.schemaIssues ?? []).join(", ") || "none"} | ${run.validation.valid} of ${run.validation.claims} | ${run.validation.problems.join("; ") || "none"} |`
            : `| ${run.name} | not checked (no tool call returned) | | | |`,
        ),
        "",
        ...(notRun.length ? ["**Not run:**", ...notRun.map((n) => `- ${n}`), ""] : []),
      ].join("\n"),
    );
    process.stdout.write(`Diagnostic report written to ${path.resolve(outDir)}\n`);
    expect(charged).toBeLessThanOrEqual(CAP);
  });
});

/** A rejected generation's size and shape; a parse break's position and ending are clues to truncation, not proof. */
function failedGeneration(run: CallRun<unknown>) {
  const failed = run.failedGeneration;
  if (!failed) return "";
  const shape = `${failed.length} chars, JSON ${failed.json}, issues ${failed.schemaIssues.join(", ") || "none"}`;
  const broken = failed.parseError;
  return broken
    ? `${shape}; ${broken.layer} (${broken.length} chars) breaks at ${broken.position ?? "unknown"}, ends in a string ${broken.endsInString}, unclosed structures ${broken.unclosed}`
    : shape;
}

function revision() {
  try {
    const commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim() !== "";
    return `${commit}${dirty ? " (uncommitted changes)" : ""}`;
  } catch {
    return "unknown";
  }
}
