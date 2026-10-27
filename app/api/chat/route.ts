import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  streamText,
  toUIMessageStream,
} from "ai";

import { getGroqModel, missingKeyResponse } from "@/lib/groq";

export const maxDuration = 30;

const SYSTEM_PROMPT = `You are ReadyState, an emergency management tabletop simulator.
Run a realistic household emergency scenario, respond to the participant's actions
with plausible consequences, and keep any privacy tags such as [Person 1] or
[Location 1] exactly as written.`;

export async function POST(req: Request) {
  const model = getGroqModel();
  if (!model) return missingKeyResponse();

  const body = await req.json().catch(() => null);
  const validated = await safeValidateUIMessages({ messages: body?.messages });
  if (!validated.success) {
    return Response.json({ error: "Invalid messages payload." }, { status: 400 });
  }

  const result = streamText({
    model,
    instructions: SYSTEM_PROMPT,
    messages: await convertToModelMessages(validated.data),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
