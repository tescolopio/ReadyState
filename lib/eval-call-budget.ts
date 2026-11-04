import type { AppMode } from "@/lib/config";

/**
 * Per-call token limits for a budgeted local eval (work item G6). The eval
 * sends the run's remaining budget and an output limit with each request; the
 * route's retry middleware, which every provider call passes through
 * (the SDK's rate-limit retries, the pre-output schema retry, the mid-stream
 * retry and the debrief repair included), then before each call:
 * - caps the call's output at the limit;
 * - reserves a conservative bound on its input (inputBound) plus that limit;
 * - refuses the call, without contacting the provider, when the reserve
 *   doesn't fit what remains.
 * A call's reserve is released for its reported usage when it finishes; a
 * call without reported usage (rejected, or cut off) keeps its whole reserve.
 *
 * Off unless the server sets READYSTATE_EVAL_BUDGET=1, and never in hosted mode
 * or on Vercel, so a deployment's calls are unchanged. Retries themselves are
 * unchanged: the eval measures production retry behavior.
 */
export const EVAL_BUDGET_HEADER = "x-readystate-eval-budget";
export const EVAL_MAX_OUTPUT_HEADER = "x-readystate-eval-max-output";

/**
 * Added to the prompt's size for what the provider wraps around it: chat
 * template tokens per message and the system preamble. The bound counts the
 * prompt's UTF-8 bytes as JSON, already several times its token count, since
 * a byte-level BPE token covers at least one byte.
 */
export const INPUT_OVERHEAD_TOKENS = 1_000;

export interface EvalCallBudget {
  /** Tokens left for this request; reduced by each call's reserve, then corrected to its reported usage. */
  remaining: number;
  maxOutputTokens: number;
}

/** Thrown before a provider call whose reserve doesn't fit: no provider is contacted. */
export class EvalBudgetExhausted extends Error {
  constructor(
    readonly needed: number,
    readonly remaining: number,
  ) {
    super(`The eval's token budget is spent: the next provider call needed up to ${needed} tokens, and ${remaining} remained. It wasn't sent.`);
    this.name = "EvalBudgetExhausted";
  }
}

export const evalBudgetEnabled = (mode: AppMode) =>
  mode !== "hosted" && process.env.VERCEL !== "1" && process.env.READYSTATE_EVAL_BUDGET === "1";

const wholeNumber = (raw: string | null) => (raw && /^\d+$/.test(raw) ? Number(raw) : undefined);

/** The request's budget, when the server allows one and the request sends both headers as whole numbers. */
export function evalCallBudget(req: Request, mode: AppMode): EvalCallBudget | null {
  if (!evalBudgetEnabled(mode)) return null;
  const remaining = wholeNumber(req.headers.get(EVAL_BUDGET_HEADER));
  const maxOutputTokens = wholeNumber(req.headers.get(EVAL_MAX_OUTPUT_HEADER));
  if (remaining === undefined || !maxOutputTokens) return null;
  return { remaining, maxOutputTokens };
}

/** An upper bound on a call's input tokens: the prompt and tool definitions as JSON, in UTF-8 bytes, plus overhead. */
export const inputBound = ({ prompt, tools }: { prompt: unknown; tools?: unknown }) =>
  Buffer.byteLength(JSON.stringify(prompt)) + Buffer.byteLength(JSON.stringify(tools ?? [])) + INPUT_OVERHEAD_TOKENS;
