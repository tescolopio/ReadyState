import { afterEach, describe, expect, it, vi } from "vitest";

import { isServerConfigured, resolveModel } from "@/lib/providers";

const modelOf = (resolved: ReturnType<typeof resolveModel>) => {
  if (!resolved.ok) throw new Error(resolved.error);
  return resolved.model as { provider: string; modelId: string };
};

describe("resolveModel", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to Groq gpt-oss-120b with medium reasoning from the server key", () => {
    vi.stubEnv("GROQ_API_KEY", "server-key");
    const resolved = resolveModel("self-hosted");
    expect(resolved).toMatchObject({ ok: true, provider: "groq", reasoning: "medium" });
    expect(modelOf(resolved).modelId).toBe("openai/gpt-oss-120b");
  });

  it("reports a missing key with the env var to set", () => {
    vi.stubEnv("GROQ_API_KEY", "");
    expect(resolveModel("self-hosted")).toEqual({
      ok: false,
      status: 400,
      error: "No API key for Groq. Add one in Settings or the server env (GROQ_API_KEY).",
    });
  });

  it("uses browser settings in self-hosted mode", () => {
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    const resolved = resolveModel("self-hosted", { provider: "google", apiKey: "browser-key" });
    expect(resolved).toMatchObject({ ok: true, provider: "google", reasoning: undefined });
    expect(modelOf(resolved).modelId).toBe("gemini-3.5-flash-lite");
  });

  it("ignores browser settings in hosted mode", () => {
    vi.stubEnv("GROQ_API_KEY", "server-key");
    const resolved = resolveModel("hosted", {
      provider: "custom",
      model: "x",
      baseURL: "http://attacker.example/v1",
    });
    expect(resolved).toMatchObject({ ok: true, provider: "groq" });
  });

  it("applies READYSTATE_* server defaults", () => {
    vi.stubEnv("READYSTATE_PROVIDER", "ollama");
    vi.stubEnv("READYSTATE_MODEL", "qwen3:8b");
    const resolved = resolveModel("hosted");
    expect(resolved).toMatchObject({ ok: true, provider: "ollama" });
    expect(modelOf(resolved).modelId).toBe("qwen3:8b");
  });

  it("runs Ollama without a key", () => {
    expect(resolveModel("self-hosted", { provider: "ollama" })).toMatchObject({ ok: true });
    expect(isServerConfigured("ollama")).toBe(true);
  });

  it("requires a model for OpenRouter and a base URL for custom endpoints", () => {
    expect(resolveModel("self-hosted", { provider: "openrouter", apiKey: "k" })).toMatchObject({
      ok: false,
      error: "Choose a model for OpenRouter in Settings.",
    });
    expect(resolveModel("self-hosted", { provider: "custom", model: "m" })).toMatchObject({
      ok: false,
      error: "Set a base URL for Custom (OpenAI-compatible) in Settings.",
    });
    expect(
      resolveModel("self-hosted", {
        provider: "custom",
        model: "m",
        baseURL: "http://localhost:1234/v1",
      }),
    ).toMatchObject({ ok: true, provider: "custom" });
  });

  it("never sends the server's key to a base URL chosen in the browser", () => {
    vi.stubEnv("CUSTOM_API_KEY", "server-key");
    vi.stubEnv("READYSTATE_BASE_URL", "");
    const resolved = resolveModel("self-hosted", {
      provider: "custom",
      model: "m",
      baseURL: "http://attacker.example/v1",
    });
    const sent = new Headers((modelOf(resolved) as unknown as { config: { headers: () => HeadersInit } }).config.headers());
    expect(sent.get("authorization")).toBe("Bearer not-needed");
  });

  it("does not let settings override fixed provider endpoints", () => {
    vi.stubEnv("GROQ_API_KEY", "server-key");
    const resolved = resolveModel("self-hosted", {
      provider: "groq",
      baseURL: "http://attacker.example/v1",
    });
    expect(resolved).toMatchObject({ ok: true, provider: "groq" });
  });
});
