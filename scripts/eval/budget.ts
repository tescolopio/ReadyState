/**
 * Conservative token accounting for a bounded household eval (work item G6),
 * from each provider call's own usage (TtxMetadata.calls).
 *
 * One request to /api/ttx can make up to MAX_PROVIDER_CALLS_PER_REQUEST
 * provider calls, every one of which may use tokens:
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
 * What a request is charged against the budget: each call's reported usage, or its full allowance when it has none.
 * A request with no per-call metadata (it failed before the server reported any) is charged its worst case.
 */
export function chargeRequest(calls: ProviderCallUsage[] | undefined, allowance: number): number {
  if (!calls) return allowance * MAX_PROVIDER_CALLS_PER_REQUEST;
  return calls.reduce((sum, call) => sum + (reportedTokens(call) ?? allowance), 0);
}

/** Calls whose reported usage exceeded the allowance: the worst-case bound no longer holds, so the run stops. */
export const overAllowance = (calls: ProviderCallUsage[] | undefined, allowance: number) =>
  (calls ?? []).filter((call) => (reportedTokens(call) ?? 0) > allowance);

/** Whether the next request's worst case still fits: checked before every request. */
export const canStart = (charged: number, budget: number, allowance: number) => charged + allowance * MAX_PROVIDER_CALLS_PER_REQUEST <= budget;

/**
 * The smallest cap that lets all `requests` start when each earlier one used a single call within its allowance:
 * the stop rule needs the last request's full worst case still free.
 */
export const capFor = (requests: number, allowance: number) => (requests - 1) * allowance + allowance * MAX_PROVIDER_CALLS_PER_REQUEST;
