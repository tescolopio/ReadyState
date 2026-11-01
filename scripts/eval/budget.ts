/**
 * Token accounting for a budgeted household eval (work item G6), from each
 * provider call's own usage (TtxMetadata.calls).
 *
 * The server enforces the budget before every provider call
 * (lib/eval-call-budget.ts): the eval sends what remains of the run's budget
 * with each request, and the route caps each call's output and refuses any
 * call whose reserve (a conservative input bound plus that cap) doesn't fit.
 * So the eval needn't reserve a request's worst case; it charges what each
 * request spent. Retries are production behavior and unchanged: one request
 * can still make up to MAX_PROVIDER_CALLS_PER_REQUEST provider calls, each of
 * which must fit what remains:
 * - 2 attempts: the first, and streamText's one `onError` retry after a
 *   malformed turn mid-stream (for a debrief: the first draft and its repair);
 * - × 3 SDK tries per attempt: the AI SDK's default 2 retries after a rate
 *   limit or server error;
 * - × 2 per try: the route's middleware retries a malformed tool call rejected
 *   before any output once.
 * The eval's own resends (after a rate limit, and after an incomplete turn) are
 * turned off for a budgeted run, so each turn is one request.
 */
import type { ProviderCallUsage } from "@/lib/ttx";

export const MAX_PROVIDER_CALLS_PER_REQUEST = 2 * 3 * 2;

/** A call's reported total, or undefined when the provider reported none (rejected, or cut off). */
export const reportedTokens = (call: ProviderCallUsage) =>
  call.inputTokens !== undefined && call.outputTokens !== undefined ? call.inputTokens + call.outputTokens : undefined;

/**
 * What a request is charged: each call's reported usage, or, when it has none, the reserve the server enforced for it
 * (`reserved`), else `unknownCall`. A request without per-call metadata (it failed before the server reported any) is
 * charged `unknownRequest`: in a budgeted run, everything that was left for it.
 */
export function chargeRequest(calls: ProviderCallUsage[] | undefined, unknownCall: number, unknownRequest: number): number {
  if (!calls) return unknownRequest;
  return calls.reduce((sum, call) => sum + (reportedTokens(call) ?? call.reserved ?? unknownCall), 0);
}

/**
 * Calls that reported more than the server enforced: input over its bound, or output over its limit. The budget's
 * guarantee then no longer holds, so the run stops.
 */
export const overBound = (calls: ProviderCallUsage[] | undefined) =>
  (calls ?? []).filter(
    (call) =>
      (call.inputBound !== undefined && (call.inputTokens ?? 0) > call.inputBound) ||
      (call.maxOutputTokens !== undefined && (call.outputTokens ?? 0) > call.maxOutputTokens),
  );
