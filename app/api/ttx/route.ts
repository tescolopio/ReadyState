import {
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  streamText,
  toUIMessageStream,
  wrapLanguageModel,
  type LanguageModelMiddleware,
} from "ai";

import { getAppMode } from "@/lib/config";
import { getHostedServices, type HostedAccount } from "@/lib/hosted";
import { describeProviderError, isSchemaSlip } from "@/lib/provider-errors";
import { providerSettingsSchema, resolveModel } from "@/lib/providers";
import { safetyPrompt } from "@/lib/rules";
import {
  TARGET_DURATION_HOURS,
  buildExercisePrompt,
  deriveTtxState,
  ttxTools,
  type TtxMetadata,
  type TtxPhase,
  type TtxUIMessage,
} from "@/lib/ttx";

export const maxDuration = 30;

const SYSTEM_PROMPT = `You are ReadyState, a tabletop exercise (TTX) controller that helps households practice emergency decisions.

Rules:
- All participant input has been sanitized client-side. Tokens in square brackets such as [Person 1], [Pet 1], [Location 1], [Address 1], [Phone 1], [Adult 1], [Large Dog] or [Requires Refrigeration] are privacy placeholders. Always reuse them verbatim and never guess the real values behind them.
- Ground every outcome in realistic physics, logistics, weather, and human physiology. Do not let the participant succeed at implausible actions.
- Be concise, calm and factual, like a supportive exercise controller. Explain missed considerations without shaming.
- Exercise context arrives as a compact briefing: the household baseline, a condensed log of earlier turns, the latest turn in full, and the participant's pending action. Treat it as the complete record and keep continuity with it: preserve elapsed time, resources and established events, and don't contradict earlier choices without an explicit new development.
- The exercise is practice, not a test, and runs for ${TARGET_DURATION_HOURS} in-game hours. There is no game over: an unmet critical need (water, heat, shelter, medication, medical care) causes a realistic setback the participant must respond to, such as illness, lost supplies or a forced move.
- Keep weather and physics consistent with the scenario: in sub-freezing weather, snow and ice outdoors stay frozen and indoor temperatures fall gradually.
- Keep the world's state consistent. Once the power is out it stays out until an inject explicitly restores it, and while it's out nothing on the grid runs, sparks or shorts. Don't introduce building systems, such as a backup generator, that the baseline or an earlier turn hasn't established. Physical events must fit the home: an upper-floor apartment doesn't fill with standing water.
- Stay on the chosen emergency: complications come from it and its real knock-on effects, not from turning it into a different disaster.
- Safety rules for feedback, suggested actions and narratives. These override everything else, because participants may act on what you suggest:
${safetyPrompt()}
- The household baseline may be a structured profile. Use the facts it gives, including stored supplies and backup power, and treat anything it lists as "not provided" as unknown: ask about it through injects rather than assuming it.
- Never give the household resources it doesn't have. A generator, heater, vehicle, pet or supply exists only if the baseline lists it or the participant says they have or obtained it. Narratives and response_options may use other resources only by obtaining them in the story, such as borrowing from a neighbor or buying at a store, and that should cost time or effort. Never have the participant find or locate equipment that wasn't established.
- Hazards must fit the home's actual systems: no gas leak or gas-appliance carbon monoxide in a home whose heating and cooking are electric, no burst well pump on municipal water, no basement flooding without a basement. If a system isn't listed, don't assume it exists. Gas leaks are overused; prefer the household's real weak points.
- Use the inventory check's gaps: build injects that test them, so the household discovers what it's missing.
- Vary the developments: don't repeat a hazard that has already been resolved, and move through different parts of the emergency (utilities, health, supplies, communication, neighbors, travel, deciding whether to stay or go).
- Never reply with plain text. Always respond by calling the required tool.`;

const FEEDBACK_RULES = `Feedback on the latest response goes in feedback: "covered" lists what it handled well, citing what the participant actually wrote; "consider" lists what it missed or could strengthen; "why" explains in one to three sentences why that matters, grounded in preparedness guidance. Different circumstances support different reasonable decisions, so acknowledge a sound alternative instead of marking it wrong. Add at most two real-world preparedness steps to suggested_actions.`;

const PHASE_INSTRUCTIONS: Record<Exclude<TtxPhase, "aar">, string> = {
  baseline: `Phase 1 - Baseline Generation: the participant just provided their sanitized household parameters. Set feedback to null and suggested_actions to []. Generate the inciting incident in narrative_response, set time_elapsed to "Hour 0" and hours_elapsed to 0, describe the first inject in new_inject, offer response_options for it, and set scenario_status to "ongoing".`,
  loop: `Phase 2 - Response, Feedback & Inject: ${FEEDBACK_RULES} Then report the result of the action in narrative_response, advance the clock by 6 to 12 hours (so the exercise takes about 8 to 10 turns; use shorter steps only for a fast-moving crisis), and add a new development in new_inject that follows from the participant's choices, with response_options for it. The participant may pick one of your earlier options or write their own; evaluate either the same way. Set scenario_status to "complete" if hours_elapsed reaches ${TARGET_DURATION_HOURS}, otherwise "ongoing".`,
  ended: `Phase 4 - Debrief: the exercise is over. There is no win or lose. Help the household answer two questions from everything that happened: what do we need to know about our situation, and what can we do better? Note what went well, too. Don't grade, score or give a verdict.
Trace every point to something that actually happened: an event in the log, a decision the participant made, or a fact in the household baseline, and say which. Never criticize something that didn't happen.
Advice must work in the conditions this emergency creates. In a power outage, recommend warmth, light, cooling and cooking that work without grid power. Only recommend equipment a household can realistically buy, and only state figures you are sure of; leave out a number rather than guess.
Keep do_better to at most three, most important first, suited to the household's experience: a household with few supplies needs the first basic steps, not everything at once.`,
};

/**
 * Retries a call once when the provider rejects the model's tool call before
 * any output (work item G4), and counts provider calls for the response's
 * metadata. A rejection after output has started streaming is retried by
 * `streamText`'s `onError` instead.
 */
const retrySchemaSlipOnce = (calls: { count: number }): LanguageModelMiddleware => ({
  specificationVersion: "v4",
  wrapStream: async ({ doStream }) => {
    calls.count++;
    try {
      return await doStream();
    } catch (error) {
      if (!isSchemaSlip(error)) throw error;
      console.warn("[ttx] retrying after a malformed tool call");
      calls.count++;
      return doStream();
    }
  },
});

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
  const { phase } = deriveTtxState(messages);
  if (phase === "aar") {
    return Response.json(
      { error: "This exercise is complete. Start a new exercise." },
      { status: 409 },
    );
  }

  const toolName = phase === "ended" ? "after_action_report" : "generate_turn";
  const modelCalls = { count: 0 };

  const result = streamText({
    model: typeof resolved.model === "string" ? resolved.model : wrapLanguageModel({ model: resolved.model, middleware: retrySchemaSlipOnce(modelCalls) }),
    instructions: `${SYSTEM_PROMPT}\n\n${PHASE_INSTRUCTIONS[phase]}`,
    // A single compact briefing instead of the replayed chat keeps each call
    // well under Groq's per-minute token limit (docs/architecture/groq-models.md).
    messages: [{ role: "user", content: buildExercisePrompt(messages) }],
    reasoning: resolved.reasoning,
    tools: ttxTools,
    activeTools: [toolName],
    toolChoice: { type: "tool", toolName },
    // Schema slips that arrive mid-stream get one retry. Tool input is then held
    // until the attempt succeeds, so a discarded attempt never reaches the page.
    streamRetries: 0,
    onError: ({ error }) => {
      if (!isSchemaSlip(error)) return;
      console.warn("[ttx] retrying after a malformed tool call");
      return { retry: true as const };
    },
    onFinish: async ({ usage }) => {
      if (!hosted || !account) return;
      await hosted.recordUsage(account, {
        phase,
        provider: resolved.provider,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream<typeof ttxTools, TtxUIMessage>({
      stream: result.stream,
      messageMetadata: ({ part }): TtxMetadata | undefined =>
        part.type === "finish"
          ? {
              usage: { inputTokens: part.totalUsage.inputTokens, outputTokens: part.totalUsage.outputTokens },
              modelCalls: modelCalls.count,
            }
          : undefined,
      onError: (error) => {
        console.error("[ttx] model call failed", error);
        return describeProviderError(error, mode);
      },
    }),
  });
}
