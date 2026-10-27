import { createOpenAI } from "@ai-sdk/openai";

const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

/**
 * Groq exposes an OpenAI-compatible Chat Completions API, so we reuse the
 * OpenAI provider with a custom baseURL. Returns `null` when no API key is set.
 */
export function getGroqModel() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const groq = createOpenAI({
    name: "groq",
    apiKey,
    baseURL: process.env.GROQ_BASE_URL ?? DEFAULT_GROQ_BASE_URL,
  });

  return groq.chat(process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL);
}

export const missingKeyResponse = () =>
  Response.json(
    { error: "GROQ_API_KEY is not configured on the server." },
    { status: 500 },
  );
