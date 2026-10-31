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
import { checkDebrief, omitKitImprovement, repairInstructions, storyDefects, type DebriefProblem } from "@/lib/debrief-checks";
import { storyFacts, storyFactsBriefing } from "@/lib/story-facts";

import { getAppMode } from "@/lib/config";
import { getHostedServices, type HostedAccount } from "@/lib/hosted";
import { reportBudgetTimeout } from "@/lib/budget-timeout";
import { exerciseHours } from "@/lib/exercise-clock";
import { describeProviderError, isSchemaSlip, providerStatus } from "@/lib/provider-errors";
import { providerSettingsSchema, resolveModel, type ResolvedModel } from "@/lib/providers";
import { safetyPrompt } from "@/lib/rules";
import {
  buildExercisePrompt,
  deriveTtxState,
  participantResponses,
  ttxTools,
  type AfterActionReport,
  type OmittedImprovement,
  type ProviderCallUsage,
  type TtxMetadata,
  type TtxPhase,
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

const SAFETY_PROMPT = safetyPrompt();

/** `hours` is the exercise clock: TARGET_DURATION_HOURS, unless a local eval set its own (lib/exercise-clock.ts). */
const systemPrompt = (hours: number) => `You are ReadyState, a tabletop exercise (TTX) controller that helps households practice emergency decisions.

Rules:
- All participant input has been sanitized client-side. Tokens in square brackets such as [Person 1], [Pet 1], [Medical 1] (a medication or medical device), [Location 1], [Address 1], [Phone 1], [Adult 1], [Large Dog] or [Requires Refrigeration] are privacy placeholders. Always reuse them verbatim and never guess the real values behind them.
- Ground every outcome in realistic physics, logistics, weather, and human physiology. Do not let the participant succeed at implausible actions.
- Be concise, calm and factual, like a supportive exercise controller. Explain missed considerations without shaming.
- Exercise context arrives as a compact briefing: the household baseline, a condensed log of earlier turns, the latest turn in full, and the participant's pending action. Treat it as the complete record and keep continuity with it: preserve elapsed time, resources and established events, and don't contradict earlier choices without an explicit new development.
- The exercise is practice, not a test, and runs for ${hours} in-game hours. There is no game over: an unmet critical need (water, heat, shelter, medication, medical care) causes a realistic setback the participant must respond to, such as illness, lost supplies or a forced move.
- Keep weather and physics consistent with the scenario: in sub-freezing weather, snow and ice outdoors stay frozen and indoor temperatures fall gradually.
- Keep the world's state consistent. Once the power is out it stays out until an inject explicitly restores it, and while it's out nothing on the grid runs, sparks or shorts. Don't introduce building systems, such as a backup generator, that the baseline or an earlier turn hasn't established. Physical events must fit the home: an upper-floor apartment doesn't fill with standing water.
- Stay on the chosen emergency: complications come from it and its real knock-on effects, not from turning it into a different disaster.
- Safety rules for feedback, suggested actions and narratives. These override everything else, because participants may act on what you suggest:
${SAFETY_PROMPT}
- The household baseline may be a structured profile. Use the facts it gives, including stored supplies and backup power, and treat anything it lists as "not provided" as unknown: ask about it through injects rather than assuming it.
- Never give the household resources it doesn't have. A generator, heater, vehicle, pet or supply exists only if the baseline lists it or the participant says they have or obtained it. Narratives and response_options may use other resources only by obtaining them in the story, such as borrowing from a neighbor or buying at a store, and that should cost time or effort. Never have the participant find or locate equipment that wasn't established.
- Hazards must fit the home's actual systems: no gas leak or gas-appliance carbon monoxide in a home whose heating and cooking are electric, no burst well pump on municipal water, no basement flooding without a basement. If a system isn't listed, don't assume it exists. Gas leaks are overused; prefer the household's real weak points.
- Use the inventory check's gaps: build injects that test them, so the household discovers what it's missing.
- Vary the developments: don't repeat a hazard that has already been resolved, and move through different parts of the emergency (utilities, health, supplies, communication, neighbors, travel, deciding whether to stay or go).
- Never reply with plain text. Always respond by calling the required tool.`;

const FEEDBACK_RULES = `Feedback on the latest response goes in feedback: "covered" lists what it handled well, citing what the participant actually wrote; "consider" lists what it missed or could strengthen; "why" explains in one to three sentences why that matters, grounded in preparedness guidance. Different circumstances support different reasonable decisions, so acknowledge a sound alternative instead of marking it wrong. Add at most two real-world preparedness steps to suggested_actions.`;

const phaseInstructions = (hours: number): Record<Exclude<TtxPhase, "aar">, string> => ({
  baseline: `Phase 1 - Baseline Generation: the participant just provided their sanitized household parameters. Set feedback to null and suggested_actions to []. Generate the inciting incident in narrative_response, set time_elapsed to "Hour 0" and hours_elapsed to 0, describe the first inject in new_inject, offer response_options for it, and set scenario_status to "ongoing".`,
  loop: `Phase 2 - Response, Feedback & Inject: ${FEEDBACK_RULES} Then report the result of the action in narrative_response, advance the clock by 6 to 12 hours (so the exercise takes about 8 to 10 turns; use shorter steps only for a fast-moving crisis), and add a new development in new_inject that follows from the participant's choices, with response_options for it. The participant may pick one of your earlier options or write their own; evaluate either the same way. Set scenario_status to "complete" if hours_elapsed reaches ${hours}, otherwise "ongoing".`,
  ended: `Phase 4 - Debrief: the exercise is over. There is no win or lose. Help the household answer two questions from everything that happened: what do we need to know about our situation, and what can we do better? Note what went well, too. Don't grade, score or give a verdict.
Trace every point to something that actually happened: an event in the log, a decision the participant made, or a fact in the household baseline, and say which. Never criticize something that didn't happen.
Advice must work in the conditions this emergency creates. In a power outage, recommend warmth, light, cooling and cooking that work without grid power. Only recommend equipment a household can realistically buy, and only state figures you are sure of; leave out a number rather than guess. Give a duration only by subtracting two logged hours you name ("from Hour 60 to Hour 72, 12 hours"); if an event's hour isn't in the log, don't state a precise duration.
Keep do_better to at most three, most important first, suited to the household's experience: a household with few supplies needs the first basic steps, not everything at once. Each improvement is one action with its evidence and why it matters; fewer than three is fine.`,
});

interface CallCounts {
  /** Every provider call, including the SDK's own retries after a rate limit. */
  providerCalls: number;
  /** Retries after a malformed tool call. */
  schemaRetries: number;
  /** Debrief repairs after failed content checks. */
  debriefRepairs: number;
  /** Each provider call's own usage, in order (TtxMetadata.calls). */
  calls: ProviderCallUsage[];
}

type ProviderUsage = { inputTokens: { total: number | undefined }; outputTokens: { total: number | undefined } };
const callUsage = (usage: ProviderUsage) => ({ inputTokens: usage.inputTokens.total, outputTokens: usage.outputTokens.total });

/**
 * Retries a call once when the provider rejects the model's tool call before
 * any output (work item G4), and counts calls for the response's metadata.
 * The SDK's rate-limit retries also pass through here, so they are counted
 * as provider calls but not as schema retries. A rejection after output has
 * started streaming is retried by `streamText`'s `onError` instead. Every
 * call's own usage is recorded too: a call rejected or cut off before the
 * provider reported usage is recorded without any.
 */
const retrySchemaSlipOnce = (counts: CallCounts): LanguageModelMiddleware => {
  const once = async <T>(call: () => PromiseLike<T>, record: (result: T, entry: ProviderCallUsage) => T): Promise<T> => {
    const attempt = async () => {
      counts.providerCalls++;
      const entry: ProviderCallUsage = {};
      counts.calls.push(entry);
      try {
        return record(await call(), entry);
      } catch (error) {
        entry.rejected = true;
        const status = providerStatus(error);
        if (status !== undefined) entry.status = status;
        throw error;
      }
    };
    try {
      return await attempt();
    } catch (error) {
      if (!isSchemaSlip(error)) throw error;
      console.warn("[ttx] retrying after a malformed tool call");
      counts.schemaRetries++;
      return attempt();
    }
  };
  return {
    specificationVersion: "v4",
    wrapStream: ({ doStream }) =>
      once(doStream, (result, entry) => ({
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream({
            transform(part, controller) {
              if (part.type === "finish") Object.assign(entry, callUsage(part.usage));
              controller.enqueue(part);
            },
          }),
        ),
      })),
    wrapGenerate: ({ doGenerate }) => once(doGenerate, (result, entry) => (Object.assign(entry, callUsage(result.usage)), result)),
  };
};

const DEBRIEF_STILL_FAILING =
  "The debrief didn't pass ReadyState's checks, even after one repair, so it isn't shown. Request the debrief again.";
const DEBRIEF_NO_TIME =
  "The debrief needed a repair, but there wasn't time before the server's limit, so it isn't shown. Request the debrief again in a minute.";

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
  const defects = storyDefects(turns, { baseline, participantText });
  // Worked out once here; the first check, the repair check and the fallback's re-check all reuse it.
  const context = { baseline, participantText, defects };
  const debriefBriefing = `${briefing}\n\n${storyFactsBriefing(storyFacts(turns, defects))}`;
  const capture = {
    drafts,
    evidence: { hours: turns.map((turn) => turn.hours_elapsed), log: briefingWithoutBaseline(debriefBriefing) },
    knownStoryDefects: defects.map(({ item, time, sentence }) => ({ item, time, sentence })),
  };

  const first = await attempt(debriefBriefing, "first");
  const failedFirst = first.failedChecks;
  if (!failedFirst.length) return { report: first.report, failedFirst, capture };

  console.warn("[ttx] debrief failed checks", failedFirst.map((p) => p.problem));
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
    console.warn("[ttx] repaired debrief still failed checks", stillFailing.map((p) => p.problem));
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
 * (lib/debrief-capture.ts). Always false in hosted mode. Also the exercise
 * clock this server uses (lib/exercise-clock.ts), for the same reason.
 */
export function GET(req: Request) {
  const mode = getAppMode();
  return Response.json({ captureDebriefDrafts: captureEnabled(req, mode), exerciseHours: exerciseHours(mode) });
}

export async function POST(req: Request) {
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
  const hours = exerciseHours(mode);
  const { phase } = deriveTtxState(messages, hours);
  if (phase === "aar") {
    return Response.json(
      { error: "This exercise is complete. Start a new exercise." },
      { status: 409 },
    );
  }

  const counts: CallCounts = { providerCalls: 0, schemaRetries: 0, debriefRepairs: 0, calls: [] };
  const budget = modelBudget(req.signal);
  const model =
    typeof resolved.model === "string"
      ? resolved.model
      : wrapLanguageModel({ model: resolved.model, middleware: retrySchemaSlipOnce(counts) });
  const instructions = `${systemPrompt(hours)}\n\n${phaseInstructions(hours)[phase]}`;
  // A single compact briefing instead of the replayed chat keeps each call
  // well under Groq's per-minute token limit (docs/architecture/groq-models.md).
  const briefing = buildExercisePrompt(messages);
  const recordUsage = async (inputTokens: number | undefined, outputTokens: number | undefined) => {
    if (!hosted || !account) return;
    await hosted.recordUsage(account, { phase, provider: resolved.provider, inputTokens, outputTokens });
  };
  const onModelError = (error: unknown) => {
    console.error("[ttx] model call failed", error);
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
              calls: counts.calls,
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
              calls: counts.calls,
              schemaRetries: counts.schemaRetries,
            }
          : undefined,
      onError: onModelError,
    }).pipeThrough(reportBudgetTimeout<InferUIMessageChunk<TtxUIMessage>>(budget.timeout, onModelError)),
  });
}
