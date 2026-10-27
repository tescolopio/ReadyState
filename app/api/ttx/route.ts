import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  streamText,
  toUIMessageStream,
} from "ai";

import { getGroqModel, missingKeyResponse } from "@/lib/groq";
import {
  TARGET_DURATION_HOURS,
  deriveTtxState,
  ttxTools,
  type TtxPhase,
  type TtxUIMessage,
} from "@/lib/ttx";

export const maxDuration = 30;

const SYSTEM_PROMPT = `You are ReadyState, an enterprise-grade Tabletop Exercise (TTX) simulator for household emergency preparedness.

Rules:
- All participant input has been sanitized client-side. Tokens in square brackets such as [Person 1], [Location 1], [Adult 1], [Large Dog] or [Requires Refrigeration] are privacy placeholders. Always reuse them verbatim and never guess the real values behind them.
- Ground every outcome in realistic physics, logistics, weather, and human physiology. Do not let the participant succeed at implausible actions.
- Be concise, factual, and professional, like an exercise controller.
- The exercise is won by surviving ${TARGET_DURATION_HOURS} in-game hours and lost when a critical constraint (water, heat, shelter, medication, medical care) is not secured in time.
- Never reply with plain text. Always respond by calling the required tool.`;

const PHASE_INSTRUCTIONS: Record<Exclude<TtxPhase, "aar">, string> = {
  baseline: `Phase 1 - Baseline Generation: the participant just provided their sanitized household parameters. Generate the inciting incident in narrative_response, set time_elapsed to "Hour 0" and hours_elapsed to 0, describe the first inject in new_inject, and set scenario_status to "ongoing".`,
  loop: `Phase 2 - Action & Inject: evaluate the participant's latest action, report the result in narrative_response, advance the clock by a realistic increment (typically 6-12 hours), and add a localized curveball in new_inject. Set scenario_status to "failed" if a critical constraint has been lost, "survived" if hours_elapsed reaches ${TARGET_DURATION_HOURS}, otherwise "ongoing".`,
  ended: `Phase 4 - After-Action Report: the exercise is over. Grade the participant's overall performance across the whole exercise and highlight the specific supply gaps that hurt them.`,
};

export async function POST(req: Request) {
  const model = getGroqModel();
  if (!model) return missingKeyResponse();

  const body = await req.json().catch(() => null);
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
    model,
    instructions: `${SYSTEM_PROMPT}\n\n${PHASE_INSTRUCTIONS[phase]}`,
    messages: await convertToModelMessages(messages),
    tools: ttxTools,
    activeTools: [toolName],
    toolChoice: { type: "tool", toolName },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
