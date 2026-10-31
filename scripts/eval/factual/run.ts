/**
 * How the G11 eval runs its calls: claim batches split to at most two claims a
 * call, each call charged against a hard budget, and every case's outcome
 * collected so a failed call leaves its cases as missing results without
 * discarding the calls that completed.
 *
 * Two claims a call is a hypothesis under test, not an established fix: the
 * five-claim D3 diagnostic failed three ways in three calls, but a two-claim
 * call (the first D1) also failed once.
 */
import type { Batch } from "./cases";
import { validate, type CallRun, type CallStatus, type ProviderJudgment, type ValidatedClaim } from "./judge";

export const MAX_CLAIMS_PER_CALL = 2;

/**
 * Each batch split into calls of at most `size` claims, in order. Every part keeps its batch's household, evidence
 * and omitted hours, so each claim gets the same evidence it had before; the evidence is repeated in every call.
 */
export function splitBatches(batches: Batch[], size = MAX_CLAIMS_PER_CALL): Batch[] {
  return batches.flatMap((batch) => {
    const parts = Math.ceil(batch.cases.length / size);
    if (parts <= 1) return [batch];
    return Array.from({ length: parts }, (_, i) => ({ ...batch, name: `${batch.name} ${i + 1} of ${parts}`, cases: batch.cases.slice(i * size, (i + 1) * size) }));
  });
}

/** The charge for a call: its full allowance for each provider call unless the provider reported its usage. */
export const chargeFor = (run: CallRun<unknown>, allowance: number) => {
  const reported = run.usage.inputTokens + run.usage.outputTokens;
  if (run.status === "provider failure") return Math.max(allowance * Math.max(1, run.providerCalls ?? 1), reported);
  return !run.usage.inputTokens || !run.usage.outputTokens ? Math.max(allowance, reported) : reported;
};

export interface PlannedCall {
  name: string;
  allowance: number;
  run: () => Promise<CallRun<unknown>>;
}

export interface RunOptions {
  budget: number;
  /** Attempts per call; 1 means no retries. */
  attempts?: number;
  /** Waits between calls, for the provider's per-minute limit. */
  pause?: () => Promise<void>;
}

/**
 * Runs the calls in order. It never starts a call whose allowance could take the charge past the budget; a call it
 * skips is recorded as not run.
 */
export async function runCalls(calls: PlannedCall[], { budget, attempts = 1, pause }: RunOptions): Promise<{ runs: CallRun<unknown>[]; charged: number }> {
  const runs: CallRun<unknown>[] = [];
  let charged = 0;
  for (const planned of calls) {
    let last: CallRun<unknown> | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (charged + planned.allowance > budget) break;
      if (runs.length && pause) await pause();
      last = await planned.run();
      last.attempts = attempt;
      charged += chargeFor(last, planned.allowance);
      runs.push(last);
      if (last.status === "completed") break;
    }
    if (!last) runs.push({ name: planned.name, status: "not run", usage: { inputTokens: 0, outputTokens: 0 }, ms: 0, attempts: 0 });
  }
  return { runs, charged };
}

/** Every case's call outcome (its batch's last attempt), and the validated judgments of the calls that completed. */
export function collectResults(batches: Batch[], runs: CallRun<unknown>[]): { status: Map<string, CallStatus>; validated: ValidatedClaim[] } {
  const status = new Map<string, CallStatus>();
  const validated = batches.flatMap((batch) => {
    const run = runs.filter((r) => r.name === batch.name).at(-1);
    if (!run) return [];
    for (const { id } of batch.cases) status.set(id, run.status);
    return run.status === "completed" ? validate(batch, run.result as ProviderJudgment).claims : [];
  });
  return { status, validated };
}
