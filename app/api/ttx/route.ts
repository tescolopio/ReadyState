import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  generateText,
  safeValidateUIMessages,
  streamText,
  toUIMessageStream,
  wrapLanguageModel,
  type InferUIMessageChunk,
  type LanguageModel,
  type LanguageModelMiddleware,
} from "ai";

import { briefingWithoutBaseline, captureEnabled, type DebriefCapture, type DebriefDraft } from "@/lib/debrief-capture";
import { checkDebrief, omitKitImprovement, repairInstructions, type DebriefProblem } from "@/lib/debrief-checks";
import { prepareDebriefContext } from "@/lib/exercise-debrief";
import { getAppMode } from "@/lib/config";
import { requireTrialAccess } from "@/lib/trial-access";
import { getHostedServices, type HostedAccount } from "@/lib/hosted";
import { reportBudgetTimeout } from "@/lib/budget-timeout";
import { describeProviderError, errorDiagnostics, isSchemaSlip } from "@/lib/provider-errors";
import { providerSettingsSchema, resolveModel, type ResolvedModel } from "@/lib/providers";
import { exercisePrompt } from "@/lib/exercise-prompts";
import {
  buildExercisePrompt,
  deriveTtxState,
  participantResponses,
  ttxTools,
  type AfterActionReport,
  type OmittedImprovement,
  type TtxMetadata,
  type TtxUIMessage,
} from "@/lib/ttx";

/** The host's deadline for this route, in seconds. */
export const maxDuration = 60;

/**
 * All model work in one request, including the SDK's waits and retries after
 * a rate limit and a debrief repair, shares this budget. It ends before
 * `maxDuration`, leaving time to send the response (eval finding 18).
 */
const MODEL_BUDGET_MS = 55_000;
/** A debrief repair starts only with this much budget left: debrief calls took 3–39 s in the eval. */
const MIN_REPAIR_BUDGET_MS = 20_000;

/** A deadline for the request's model work, also ended if the participant stops the request. */
function modelBudget(requestSignal: AbortSignal) {
  const deadline = Date.now() + MODEL_BUDGET_MS;
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(MODEL_BUDGET_MS)]);
  return {
    signal,
    remainingMs: () => deadline - Date.now(),
    /** The timeout's error when the budget ran out, rather than the participant stopping the request. */
    timeout: (): unknown => (signal.aborted && !requestSignal.aborted ? signal.reason : undefined),
  };
}

interface CallCounts {
  /** Every provider call, including the SDK's own retries after a rate limit. */
  providerCalls: number;
  /** Retries after a malformed tool call. */
  schemaRetries: number;
  /** Debrief repairs after failed content checks. */
  debriefRepairs: number;
}

/**
 * Retries a call once when the provider rejects the model's tool call before
 * any output (work item G4), and counts calls for the response's metadata.
 * The SDK's rate-limit retries also pass through here, so they are counted
 * as provider calls but not as schema retries. A rejection after output has
 * started streaming is retried by `streamText`'s `onError` instead.
 */
const retrySchemaSlipOnce = (counts: CallCounts): LanguageModelMiddleware => {
  const once = async <T>(call: () => PromiseLike<T>): Promise<T> => {
    counts.providerCalls++;
    try {
      return await call();
    } catch (error) {
      if (!isSchemaSlip(error)) throw error;
      console.warn("[ttx] retrying after a malformed tool call");
      counts.providerCalls++;
      counts.schemaRetries++;
      return call();
    }
  };
  return {
    specificationVersion: "v4",
    wrapStream: ({ doStream }) => once(doStream),
    wrapGenerate: ({ doGenerate }) => once(doGenerate),
  };
};

const DEBRIEF_STILL_FAILING =
  "The debrief didn't pass ReadyState's checks, even after one repair, so it isn't shown. Request the debrief again.";
const DEBRIEF_NO_TIME =
  "The debrief needed a repair, but there wasn't time before the server's limit, so it isn't shown. Request the debrief again in a minute.";

/** Which checks failed and where, for server logs. A problem's text quotes the debrief, so it isn't logged. */
const checkNames = (problems: DebriefProblem[]) => problems.map(({ category, check, field }) => ({ category, check, field }));

type DebriefOutcome = (
  | { report: AfterActionReport; failedFirst: DebriefProblem[]; omitted?: OmittedImprovement }
  | { error: string; failedFirst: DebriefProblem[]; stillFailing?: DebriefProblem[] }
) & { capture: Omit<DebriefCapture, "provider" | "model"> };

/**
 * Generates the debrief whole and runs the implemented checks
 * (lib/debrief-checks.ts). If any fail, it asks the model once to repair
 * exactly those, provided enough of the request's budget is left. A debrief
 * that still fails is never presented as checked: the outcome is an error the
 * participant can recover from by asking again.
 *
 * If the repair's only failure is one improvement's kit list, that improvement
 * is dropped instead (omitKitImprovement), and the participant is told.
 *
 * The briefing ends with a note of story facts (lib/story-facts.ts): logged
 * hours, power and heating after it returned, equipment the story invented,
 * and that only the participant's responses are their actions. Every
 * draft is kept in the outcome's capture, which only reaches a local eval
 * that asked for it (lib/debrief-capture.ts).
 */
async function generateCheckedDebrief({
  model,
  instructions,
  briefing,
  messages,
  reasoning,
  budget,
  counts,
  usage,
}: {
  model: LanguageModel;
  instructions: string;
  briefing: string;
  messages: TtxUIMessage[];
  reasoning: Extract<ResolvedModel, { ok: true }>["reasoning"];
  budget: ReturnType<typeof modelBudget>;
  counts: CallCounts;
  usage: { inputTokens: number; outputTokens: number };
}): Promise<DebriefOutcome> {
  const drafts: DebriefDraft[] = [];
  const attempt = async (content: string, label: DebriefDraft["attempt"]) => {
    const started = Date.now();
    const result = await generateText({
      model,
      instructions,
      messages: [{ role: "user", content }],
      reasoning,
      tools: ttxTools,
      activeTools: ["after_action_report"],
      toolChoice: { type: "tool", toolName: "after_action_report" },
      abortSignal: budget.signal,
    });
    const draftUsage = { inputTokens: result.totalUsage.inputTokens ?? 0, outputTokens: result.totalUsage.outputTokens ?? 0 };
    usage.inputTokens += draftUsage.inputTokens;
    usage.outputTokens += draftUsage.outputTokens;
    const call = result.toolCalls.find((toolCall) => toolCall.toolName === "after_action_report");
    if (!call) throw new Error("The model returned no debrief.");
    const report = call.input as AfterActionReport;
    const failedChecks = checkDebrief(report, turns, context);
    drafts.push({
      attempt: label,
      status: failedChecks.length ? "rejected" : "accepted",
      report,
      failedChecks,
      ms: Date.now() - started,
      usage: draftUsage,
    });
    return { report, failedChecks };
  };

  const { turns } = deriveTtxState(messages);
  // participantText[i] is the participant's message after turns[i].
  const { baseline, responses: participantText } = participantResponses(messages);
  // Worked out once here; the first check, the repair check and the fallback's re-check all reuse it.
  const { context, briefing: debriefBriefing } = prepareDebriefContext({ turns, baseline, participantText, briefing });
  const capture = {
    drafts,
    evidence: { hours: turns.map((turn) => turn.hours_elapsed), log: briefingWithoutBaseline(debriefBriefing) },
    knownStoryDefects: context.defects.map(({ item, time, sentence }) => ({ item, time, sentence })),
  };

  const first = await attempt(debriefBriefing, "first");
  const failedFirst = first.failedChecks;
  if (!failedFirst.length) return { report: first.report, failedFirst, capture };

  console.warn("[ttx] debrief failed checks", checkNames(failedFirst));
  if (budget.remainingMs() < MIN_REPAIR_BUDGET_MS) return { error: DEBRIEF_NO_TIME, failedFirst, capture };

  counts.debriefRepairs++;
  const repaired = await attempt(
    `${debriefBriefing}\n\n${repairInstructions(failedFirst)}\n\nYOUR PREVIOUS DEBRIEF (JSON):\n${JSON.stringify(first.report)}`,
    "repair",
  );
  const stillFailing = repaired.failedChecks;
  const fallback = omitKitImprovement(repaired.report, stillFailing, turns, context);
  if (fallback) {
    const omitted = { action: fallback.omitted.action, checks: fallback.checks };
    console.warn("[ttx] omitted a kit-list improvement after the repair", omitted.checks);
    return { report: fallback.report, failedFirst, omitted, capture: { ...capture, omitted: { ...omitted, stillFailing, report: fallback.report } } };
  }
  if (stillFailing.length) {
    console.warn("[ttx] repaired debrief still failed checks", checkNames(stillFailing));
    return { error: DEBRIEF_STILL_FAILING, failedFirst, stillFailing, capture };
  }
  return { report: repaired.report, failedFirst, capture };
}

const errorResponse = (status: number, error: string) =>
  Response.json({ error }, { status });

/**
 * Rejects requests that didn't come from this app's own page. Requiring JSON
 * forces a CORS preflight, which fails because this route sends no CORS
 * headers, and a cross-origin `Origin` is refused outright. Without this, any
 * website open in the user's browser could drive a self-hosted server and
 * spend its keys.
 */
function rejectCrossSite(req: Request): Response | null {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return errorResponse(415, "Expected a JSON request body.");
  }
  // Browsers always send Origin on cross-origin POSTs; same-origin ones match Host.
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && (!URL.canParse(origin) || new URL(origin).host !== host)) {
    return errorResponse(403, "Cross-origin requests are not allowed.");
  }
  return null;
}

/**
 * Whether this server would capture debrief drafts for this request, so a
 * local eval can confirm it before spending a model call
 * (lib/debrief-capture.ts). Always false in hosted mode and on Vercel.
 */
export function GET(req: Request) {
  const denied = requireTrialAccess(req);
  if (denied) return denied;
  return Response.json({ captureDebriefDrafts: captureEnabled(req, getAppMode()) });
}

export async function POST(req: Request) {
  // Enforce access at the model boundary as well as in Proxy.
  const denied = requireTrialAccess(req);
  if (denied) return denied;
  const rejected = rejectCrossSite(req);
  if (rejected) return rejected;

  const mode = getAppMode();

  // Hosted mode fails closed: no implementation means no anonymous model calls.
  const hosted = mode === "hosted" ? getHostedServices() : null;
  let account: HostedAccount | null = null;
  if (mode === "hosted") {
    if (!hosted) return errorResponse(503, "Hosted mode is not configured on this server.");
    account = await hosted.authenticate(req);
    if (!account) return errorResponse(401, "Sign in to run an exercise.");
    const quota = await hosted.checkQuota(account);
    if (!quota.allowed) return errorResponse(402, quota.reason);
  }

  const body = await req.json().catch(() => null);
  const settings = providerSettingsSchema.optional().safeParse(body?.settings ?? undefined);
  if (!settings.success) return errorResponse(400, "Invalid provider settings.");
  const resolved = resolveModel(mode, settings.data);
  if (!resolved.ok) return errorResponse(resolved.status, resolved.error);

  const validated = await safeValidateUIMessages<TtxUIMessage>({
    messages: body?.messages,
    tools: ttxTools,
  });
  if (!validated.success) {
    return Response.json({ error: "Invalid messages payload." }, { status: 400 });
  }

  const messages = validated.data;
  const { phase } = deriveTtxState(messages);
  if (phase === "aar") {
    return Response.json(
      { error: "This exercise is complete. Start a new exercise." },
      { status: 409 },
    );
  }

  const counts: CallCounts = { providerCalls: 0, schemaRetries: 0, debriefRepairs: 0 };
  const budget = modelBudget(req.signal);
  const model =
    typeof resolved.model === "string"
      ? resolved.model
      : wrapLanguageModel({ model: resolved.model, middleware: retrySchemaSlipOnce(counts) });
  const prompt = exercisePrompt(phase);
  const instructions = `${prompt.system}\n- Never reply with plain text. Always respond by calling the required tool.\n\n${prompt.phase}`;
  // A single compact briefing instead of the replayed chat keeps each call
  // well under Groq's per-minute token limit (docs/architecture/groq-models.md).
  const briefing = buildExercisePrompt(messages);
  const recordUsage = async (inputTokens: number | undefined, outputTokens: number | undefined) => {
    if (!hosted || !account) return;
    await hosted.recordUsage(account, { phase, provider: resolved.provider, inputTokens, outputTokens });
  };
  const onModelError = (error: unknown) => {
    console.error("[ttx] model call failed", errorDiagnostics(error));
    return describeProviderError(error, mode);
  };

  if (phase === "ended") {
    const capture = captureEnabled(req, mode);
    const modelId = typeof resolved.model === "string" ? resolved.model : resolved.model.modelId;
    return createUIMessageStreamResponse({
      stream: createUIMessageStream<TtxUIMessage>({
        execute: async ({ writer }) => {
          const usage = { inputTokens: 0, outputTokens: 0 };
          try {
            const outcome = await generateCheckedDebrief({
              model,
              instructions,
              briefing,
              messages,
              reasoning: resolved.reasoning,
              budget,
              counts,
              usage,
            });
            const problems = (list: DebriefProblem[]) => list.map((p) => p.problem);
            const counters = {
              usage,
              providerCalls: counts.providerCalls,
              schemaRetries: counts.schemaRetries,
              debriefRepairs: counts.debriefRepairs,
              ...(capture ? { debriefCapture: { provider: resolved.provider, model: modelId, ...outcome.capture } } : {}),
            };
            if ("error" in outcome) {
              // The counters and failed checks still go out, for the eval; the debrief doesn't.
              writer.write({
                type: "start",
                messageMetadata: {
                  ...counters,
                  debriefChecks: {
                    passedImplementedChecks: false,
                    failedFirst: problems(outcome.failedFirst),
                    ...(outcome.stillFailing ? { stillFailing: problems(outcome.stillFailing) } : {}),
                  },
                },
              });
              writer.write({ type: "error", errorText: outcome.error });
              return;
            }
            const metadata: TtxMetadata = {
              ...counters,
              debriefChecks: {
                passedImplementedChecks: true,
                failedFirst: problems(outcome.failedFirst),
                ...(outcome.omitted ? { omittedImprovement: outcome.omitted } : {}),
              },
            };
            const toolCallId = generateId();
            writer.write({ type: "start", messageMetadata: metadata });
            writer.write({ type: "tool-input-available", toolCallId, toolName: "after_action_report", input: outcome.report });
            writer.write({ type: "tool-output-available", toolCallId, output: outcome.report });
            writer.write({ type: "finish", messageMetadata: metadata });
          } finally {
            await recordUsage(usage.inputTokens, usage.outputTokens);
          }
        },
        onError: onModelError,
      }),
    });
  }

  let streamRetried = false;
  const result = streamText({
    model,
    instructions,
    messages: [{ role: "user", content: briefing }],
    reasoning: resolved.reasoning,
    tools: ttxTools,
    activeTools: ["generate_turn"],
    toolChoice: { type: "tool", toolName: "generate_turn" },
    abortSignal: budget.signal,
    // Schema slips that arrive mid-stream get one retry. Tool input is then held
    // until the attempt succeeds, so a discarded attempt never reaches the page.
    streamRetries: 0,
    onError: ({ error }) => {
      // The SDK grants one callback-directed retry per step, so only the first slip is a retry.
      if (!isSchemaSlip(error) || streamRetried) return;
      streamRetried = true;
      console.warn("[ttx] retrying after a malformed tool call");
      counts.schemaRetries++;
      return { retry: true as const };
    },
    onFinish: async ({ usage }) => recordUsage(usage.inputTokens, usage.outputTokens),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream<typeof ttxTools, TtxUIMessage>({
      stream: result.stream,
      messageMetadata: ({ part }): TtxMetadata | undefined =>
        part.type === "finish"
          ? {
              usage: { inputTokens: part.totalUsage.inputTokens, outputTokens: part.totalUsage.outputTokens },
              providerCalls: counts.providerCalls,
              schemaRetries: counts.schemaRetries,
            }
          : undefined,
      onError: onModelError,
    }).pipeThrough(reportBudgetTimeout<InferUIMessageChunk<TtxUIMessage>>(budget.timeout, onModelError)),
  });
}
