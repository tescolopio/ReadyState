import {
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  streamText,
  toUIMessageStream,
} from "ai";

import { getAppMode } from "@/lib/config";
import { getHostedServices, type HostedAccount } from "@/lib/hosted";
import { providerSettingsSchema, resolveModel } from "@/lib/providers";
import {
  TARGET_DURATION_HOURS,
  buildExercisePrompt,
  deriveTtxState,
  ttxTools,
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
- Safety rules for feedback and suggested actions. These override everything else, because participants may act on what you suggest:
  - Never suggest heating with a gas stove or oven, a grill, a camp stove, a generator or any unvented fuel-burning heater indoors (carbon monoxide). Generators run only outdoors, far from doors and windows.
  - Credit protective actions such as shutting off gas after a suspected leak, evacuating, or calling for help, even when they make other things harder.
  - For injuries and medical emergencies, recommend contacting emergency services or a medical professional, and don't give treatment instructions beyond basic first aid.
- The household baseline may be a structured profile. Use the facts it gives, including stored supplies and backup power, and treat anything it lists as "not provided" as unknown: ask about it through injects rather than assuming it.
- Never reply with plain text. Always respond by calling the required tool.`;

const FEEDBACK_RULES = `Feedback on the latest response goes in feedback: "covered" lists what it handled well, citing what the participant actually wrote; "consider" lists what it missed or could strengthen; "why" explains in one to three sentences why that matters, grounded in preparedness guidance. Different circumstances support different reasonable decisions, so acknowledge a sound alternative instead of marking it wrong. Add at most two real-world preparedness steps to suggested_actions.`;

const PHASE_INSTRUCTIONS: Record<Exclude<TtxPhase, "aar">, string> = {
  baseline: `Phase 1 - Baseline Generation: the participant just provided their sanitized household parameters. Set feedback to null and suggested_actions to []. Generate the inciting incident in narrative_response, set time_elapsed to "Hour 0" and hours_elapsed to 0, describe the first inject in new_inject, offer response_options for it, and set scenario_status to "ongoing".`,
  loop: `Phase 2 - Response, Feedback & Inject: ${FEEDBACK_RULES} Then report the result of the action in narrative_response, advance the clock by a realistic increment (typically 6-12 hours), and add a new development in new_inject that follows from the participant's choices, with response_options for it. The participant may pick one of your earlier options or write their own; evaluate either the same way. Set scenario_status to "complete" if hours_elapsed reaches ${TARGET_DURATION_HOURS}, otherwise "ongoing".`,
  ended: `Phase 4 - Debrief: the exercise is over. There is no win or lose. Help the household answer two questions from everything that happened: what do we need to know about our situation, and what can we do better? Note what went well, too. Don't grade, score or give a verdict.`,
};

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

  const result = streamText({
    model: resolved.model,
    instructions: `${SYSTEM_PROMPT}\n\n${PHASE_INSTRUCTIONS[phase]}`,
    // A single compact briefing instead of the replayed chat keeps each call
    // well under Groq's per-minute token limit (docs/architecture/groq-models.md).
    messages: [{ role: "user", content: buildExercisePrompt(messages) }],
    reasoning: resolved.reasoning,
    tools: ttxTools,
    activeTools: [toolName],
    toolChoice: { type: "tool", toolName },
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
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
