import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import {
  APICallError,
  StreamProviderError,
  readUIMessageStream,
  simulateReadableStream,
  type UIMessageChunk,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TtxUIMessage } from "@/lib/ttx";

import type { HostedServices } from "@/lib/hosted";
import { SAFETY_RULES } from "@/lib/rules";

const env = vi.hoisted(() => ({
  model: null as unknown,
  mode: "self-hosted" as "self-hosted" | "hosted",
  hosted: null as HostedServices | null,
  resolveCalls: [] as unknown[][],
}));
vi.mock("@/lib/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers")>()),
  resolveModel: (...args: unknown[]) => {
    env.resolveCalls.push(args);
    return env.model
      ? { ok: true, provider: "groq", model: env.model, reasoning: "medium" }
      : { ok: false, status: 400, error: "No API key for Groq." };
  },
}));
vi.mock("@/lib/config", () => ({ getAppMode: () => env.mode }));
vi.mock("@/lib/hosted", () => ({ getHostedServices: () => env.hosted }));

const { POST } = await import("./route");

const turnInput = {
  feedback: null,
  narrative_response: "A blizzard cuts power to [Location 1].",
  time_elapsed: "Hour 0",
  hours_elapsed: 0,
  new_inject: "[Person 1] reports the furnace is silent.",
  critical_alerts: ["Heat source offline"],
  suggested_actions: [],
  response_options: [],
  scenario_status: "ongoing",
};

const mockToolCallModel = (toolName: string, input: unknown) =>
  new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName,
            input: JSON.stringify(input),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: undefined },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  });

const post = (
  messages: unknown,
  settings?: unknown,
  headers: Record<string, string> = { "content-type": "application/json" },
) =>
  POST(
    new Request("http://localhost/api/ttx", {
      method: "POST",
      headers,
      body: JSON.stringify({ messages, settings }),
    }),
  );

const systemText = (model: MockLanguageModelV4) =>
  model.doStreamCalls[0].prompt
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");

/** The assistant message as the page would end up with it. */
async function lastMessage(res: Response) {
  let last: TtxUIMessage | undefined;
  for await (const message of readUIMessageStream<TtxUIMessage>({
    stream: res.body!
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(
        new TransformStream<string, UIMessageChunk>({
          transform(text, controller) {
            for (const line of text.split("\n")) {
              if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
              controller.enqueue(JSON.parse(line.slice(6)));
            }
          },
        }),
      ),
  })) {
    last = message;
  }
  return last;
}

/** Groq's rejection of a tool call that doesn't match the schema (eval finding 8). */
const schemaSlipMessage =
  "tool call validation failed: parameters for tool generate_turn did not match schema: errors: [`/feedback/why`: expected string, but got array]";

const schemaSlipError = () =>
  new APICallError({
    message: schemaSlipMessage,
    url: "https://api.groq.com/openai/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 400,
    responseBody: JSON.stringify({ error: { message: schemaSlipMessage, code: "tool_use_failed" } }),
  });

/** Fails its first call with `firstFailure`, then behaves like `good`. */
const failingOnce = (good: MockLanguageModelV4, firstFailure: () => ReturnType<MockLanguageModelV4["doStream"]>) => {
  let calls = 0;
  return new MockLanguageModelV4({
    doStream: async (options) => (calls++ === 0 ? firstFailure() : good.doStream(options)),
  });
};

const userMessage: TtxUIMessage = {
  id: "u1",
  role: "user",
  parts: [{ type: "text", text: "[Person 1], [Large Dog], live in [Location 1]." }],
};

describe("POST /api/ttx", () => {
  beforeEach(() => {
    env.model = null;
    env.mode = "self-hosted";
    env.hosted = null;
    env.resolveCalls = [];
  });

  it("returns the provider error when no model can be resolved", async () => {
    const res = await post([userMessage]);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No API key for Groq." });
  });

  it("passes browser provider settings to the resolver", async () => {
    env.model = mockToolCallModel("generate_turn", turnInput);
    const settings = { provider: "google", apiKey: "k" };
    const res = await post([userMessage], settings);
    await res.text();
    expect(env.resolveCalls[0]).toEqual(["self-hosted", settings]);
  });

  it("rejects malformed provider settings", async () => {
    env.model = mockToolCallModel("generate_turn", turnInput);
    const res = await post([userMessage], { provider: "nope" });
    expect(res.status).toBe(400);
  });

  it("rejects requests that could come from another website", async () => {
    // A cross-site form or no-cors fetch can only send "simple" content types.
    expect((await post([], undefined, { "content-type": "text/plain" })).status).toBe(415);
    const crossOrigin = await post([], undefined, {
      "content-type": "application/json",
      host: "localhost:3000",
      origin: "https://attacker.example",
    });
    expect(crossOrigin.status).toBe(403);
    expect(env.resolveCalls).toEqual([]);
  });

  it("accepts same-origin requests from the app's page", async () => {
    const response = await post([], undefined, {
      "content-type": "application/json",
      host: "localhost:3000",
      origin: "http://localhost:3000",
    });
    expect(response.status).toBe(400); // past the guard, then the empty payload is rejected
  });

  it("rejects invalid payloads", async () => {
    env.model = mockToolCallModel("generate_turn", turnInput);
    const res = await post("nope");
    expect(res.status).toBe(400);
  });

  it("forces the generate_turn tool and streams structured turn data", async () => {
    const model = mockToolCallModel("generate_turn", turnInput);
    env.model = model;

    const res = await post([userMessage]);
    expect(res.status).toBe(200);

    const last = await lastMessage(res);

    expect(model.doStreamCalls[0].toolChoice).toEqual({
      type: "tool",
      toolName: "generate_turn",
    });
    expect(model.doStreamCalls[0].reasoning).toBe("medium");
    expect(systemText(model)).toContain("There is no game over");
    // Every safety rule in data/rules/safety.json reaches the model.
    for (const rule of SAFETY_RULES) expect(systemText(model)).toContain(rule.prompt);
    const sent = model.doStreamCalls[0].prompt.filter((m) => m.role !== "system");
    expect(sent).toEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "HOUSEHOLD BASELINE (sanitized):\n[Person 1], [Large Dog], live in [Location 1].",
          },
        ],
      },
    ]);
    const part = last?.parts.find((p) => p.type === "tool-generate_turn");
    expect(part).toMatchObject({ state: "output-available", output: turnInput });
  });

  it("retries once when the provider rejects a malformed turn before any output", async () => {
    const model = failingOnce(mockToolCallModel("generate_turn", turnInput), async () => {
      throw schemaSlipError();
    });
    env.model = model;

    const last = await lastMessage(await post([userMessage]));
    expect(model.doStreamCalls).toHaveLength(2);
    expect(last?.parts.find((p) => p.type === "tool-generate_turn")).toMatchObject({
      state: "output-available",
      output: turnInput,
    });
  });

  it("retries once when a malformed turn is rejected mid-stream", async () => {
    const model = failingOnce(mockToolCallModel("generate_turn", turnInput), async () => ({
      stream: simulateReadableStream<LanguageModelV4StreamPart>({
        chunks: [
          { type: "reasoning-start", id: "r1" },
          { type: "reasoning-delta", id: "r1", delta: "Thinking about the storm." },
          { type: "reasoning-end", id: "r1" },
          {
            type: "error",
            error: new StreamProviderError({ message: schemaSlipMessage, code: "tool_use_failed", statusCode: 400 }),
          },
        ],
      }),
    }));
    env.model = model;

    const last = await lastMessage(await post([userMessage]));
    expect(model.doStreamCalls).toHaveLength(2);
    expect(last?.parts.find((p) => p.type === "tool-generate_turn")).toMatchObject({
      state: "output-available",
      output: turnInput,
    });
  });

  it("explains a malformed turn that fails twice instead of retrying again", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw schemaSlipError();
      },
    });
    env.model = model;

    const body = await (await post([userMessage])).text();
    expect(model.doStreamCalls).toHaveLength(2);
    expect(body).toContain("The model returned an incomplete turn.");
  });

  it("forces the after_action_report tool once the exercise has ended", async () => {
    const model = mockToolCallModel("after_action_report", {});
    env.model = model;
    const ended = { ...turnInput, hours_elapsed: 72, scenario_status: "complete" };

    const res = await post([
      userMessage,
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-generate_turn",
            toolCallId: "c1",
            state: "output-available",
            input: ended,
            output: ended,
          },
        ],
      },
      { id: "u2", role: "user", parts: [{ type: "text", text: "Generate the AAR" }] },
    ]);
    await res.text();

    expect(model.doStreamCalls[0].toolChoice).toEqual({
      type: "tool",
      toolName: "after_action_report",
    });
    // Decision D8: a review of decisions, not a grade.
    expect(systemText(model)).toContain("Don't grade, score or give a verdict.");
  });
});

describe("POST /api/ttx in hosted mode", () => {
  const account = { userId: "user-1" };
  const hostedServices = (overrides: Partial<HostedServices> = {}): HostedServices => ({
    authenticate: vi.fn(async () => account),
    checkQuota: vi.fn(async () => ({ allowed: true as const })),
    recordUsage: vi.fn(async () => {}),
    ...overrides,
  });

  beforeEach(() => {
    env.model = mockToolCallModel("generate_turn", turnInput);
    env.mode = "hosted";
    env.resolveCalls = [];
  });

  it("fails closed with 503 when no hosted services are wired up", async () => {
    env.hosted = null;
    const res = await post([userMessage]);
    expect(res.status).toBe(503);
  });

  it("requires a signed-in account", async () => {
    env.hosted = hostedServices({ authenticate: vi.fn(async () => null) });
    const res = await post([userMessage]);
    expect(res.status).toBe(401);
  });

  it("returns 402 when the account is out of quota", async () => {
    env.hosted = hostedServices({
      checkQuota: vi.fn(async () => ({ allowed: false as const, reason: "Out of credits." })),
    });
    const res = await post([userMessage]);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "Out of credits." });
  });

  it("resolves the model in hosted mode and records usage after the call", async () => {
    const services = hostedServices();
    env.hosted = services;
    const res = await post([userMessage], { provider: "custom", baseURL: "http://evil" });
    await res.text();

    expect(env.resolveCalls[0][0]).toBe("hosted");
    expect(services.recordUsage).toHaveBeenCalledWith(account, {
      phase: "baseline",
      provider: "groq",
      inputTokens: 1,
      outputTokens: 1,
    });
  });
});
