import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { z } from "zod";

import type { AppMode } from "@/lib/config";

export const PROVIDER_IDS = [
  "groq",
  "google",
  "cerebras",
  "openrouter",
  "ollama",
  "custom",
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

type Reasoning = "low" | "medium" | "high";

interface ProviderPreset {
  label: string;
  kind: "openai-compatible" | "google";
  /** Default endpoint. Required (and user-supplied) for `custom`. */
  baseURL?: string;
  /** Server env var that overrides `baseURL` (e.g. Ollama on the Docker host). */
  baseURLEnv?: string;
  /** Omitted when the model must be chosen by the user (e.g. OpenRouter). */
  defaultModel?: string;
  /** Server env var holding this provider's API key. */
  keyEnv?: string;
  requiresKey: boolean;
  /**
   * AI SDK `reasoning` option, only for models known to accept
   * `reasoning_effort`. Other endpoints may reject the parameter.
   */
  reasoning?: Reasoning;
  /** Whether the user may point this provider at a different endpoint. */
  editableBaseURL?: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  groq: {
    label: "Groq",
    kind: "openai-compatible",
    baseURL: "https://api.groq.com/openai/v1",
    defaultModel: "openai/gpt-oss-120b",
    keyEnv: "GROQ_API_KEY",
    requiresKey: true,
    // "high" costs 3-5x the tokens with no visible quality gain for this task.
    reasoning: "medium",
  },
  google: {
    label: "Google Gemini",
    kind: "google",
    defaultModel: "gemini-3.5-flash-lite",
    keyEnv: "GOOGLE_GENERATIVE_AI_API_KEY",
    requiresKey: true,
  },
  cerebras: {
    label: "Cerebras",
    kind: "openai-compatible",
    baseURL: "https://api.cerebras.ai/v1",
    defaultModel: "gpt-oss-120b",
    keyEnv: "CEREBRAS_API_KEY",
    requiresKey: true,
    reasoning: "medium",
  },
  openrouter: {
    label: "OpenRouter",
    kind: "openai-compatible",
    baseURL: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    requiresKey: true,
  },
  ollama: {
    label: "Ollama (local)",
    kind: "openai-compatible",
    baseURL: "http://localhost:11434/v1",
    baseURLEnv: "OLLAMA_BASE_URL",
    defaultModel: "gpt-oss:20b",
    requiresKey: false,
    editableBaseURL: true,
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    kind: "openai-compatible",
    keyEnv: "CUSTOM_API_KEY",
    requiresKey: false,
    editableBaseURL: true,
  },
};

/** Provider choice sent by the browser's Settings panel (self-hosted only). */
export const providerSettingsSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  model: z.string().trim().max(200).optional(),
  apiKey: z.string().trim().max(500).optional(),
  baseURL: z.string().trim().max(500).optional(),
});
export type ProviderSettings = z.infer<typeof providerSettingsSchema>;

/** Key-free server description returned by `GET /api/config`. */
export interface ServerConfig {
  mode: AppMode;
  defaultProvider: ProviderId;
  providers: Array<{
    id: ProviderId;
    label: string;
    defaultModel: string | null;
    requiresKey: boolean;
    editableBaseURL: boolean;
    serverConfigured: boolean;
  }>;
}

export type ResolvedModel =
  | { ok: true; provider: ProviderId; model: LanguageModel; reasoning?: Reasoning }
  | { ok: false; status: number; error: string };

const blankToUndefined = (value?: string) => (value?.trim() ? value.trim() : undefined);

const isProviderId = (value: string | undefined): value is ProviderId =>
  PROVIDER_IDS.includes(value as ProviderId);

/** Server defaults from env: `READYSTATE_PROVIDER`, `READYSTATE_MODEL`, `READYSTATE_BASE_URL`. */
export function serverDefaultProvider(): ProviderId {
  const configured = process.env.READYSTATE_PROVIDER;
  return isProviderId(configured) ? configured : "groq";
}

const serverKeyFor = (provider: ProviderId) => {
  const env = PROVIDERS[provider].keyEnv;
  return env ? blankToUndefined(process.env[env]) : undefined;
};

/** Whether the server env already holds what this provider needs. */
export const isServerConfigured = (provider: ProviderId) =>
  !PROVIDERS[provider].requiresKey || serverKeyFor(provider) !== undefined;

/**
 * Picks the model for one request. In `hosted` mode browser settings are
 * ignored entirely: customers can't redirect the operator's server to other
 * endpoints or keys. In `self-hosted` mode the browser's choice wins, and any
 * field it leaves blank falls back to the server env.
 */
export function resolveModel(
  mode: AppMode,
  clientSettings?: ProviderSettings,
): ResolvedModel {
  const settings = mode === "self-hosted" ? clientSettings : undefined;
  const provider = settings?.provider ?? serverDefaultProvider();
  const preset = PROVIDERS[provider];
  const usesServerDefaults = provider === serverDefaultProvider();

  const modelId =
    blankToUndefined(settings?.model) ??
    (usesServerDefaults ? blankToUndefined(process.env.READYSTATE_MODEL) : undefined) ??
    preset.defaultModel;
  const apiKey = blankToUndefined(settings?.apiKey) ?? serverKeyFor(provider);
  const baseURL =
    (preset.editableBaseURL ? blankToUndefined(settings?.baseURL) : undefined) ??
    (usesServerDefaults ? blankToUndefined(process.env.READYSTATE_BASE_URL) : undefined) ??
    (preset.baseURLEnv ? blankToUndefined(process.env[preset.baseURLEnv]) : undefined) ??
    preset.baseURL;

  if (!modelId) {
    return { ok: false, status: 400, error: `Choose a model for ${preset.label} in Settings.` };
  }
  if (preset.requiresKey && !apiKey) {
    const where = mode === "hosted" ? "on the server" : "in Settings or the server env";
    return {
      ok: false,
      status: mode === "hosted" ? 500 : 400,
      error: `No API key for ${preset.label}. Add one ${where}${preset.keyEnv ? ` (${preset.keyEnv})` : ""}.`,
    };
  }
  if (preset.kind === "openai-compatible" && !baseURL) {
    return { ok: false, status: 400, error: `Set a base URL for ${preset.label} in Settings.` };
  }

  const model =
    preset.kind === "google"
      ? createGoogleGenerativeAI({ apiKey })(modelId)
      : createOpenAI({
          name: provider,
          // Keyless local servers (Ollama, LM Studio) still expect a bearer value.
          apiKey: apiKey ?? "not-needed",
          baseURL,
        }).chat(modelId);

  return { ok: true, provider, model, reasoning: preset.reasoning };
}
