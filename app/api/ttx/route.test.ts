import { readUIMessageStream, simulateReadableStream, type UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TtxUIMessage } from "@/lib/ttx";

import type { HostedServices } from "@/lib/hosted";

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
  narrative_response: "A blizzard cuts power to [Location 1].",
  time_elapsed: "Hour 0",
  hours_elapsed: 0,
  new_inject: "[Person 1] reports the furnace is silent.",
  critical_alerts: ["Heat source offline"],
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

const post = (messages: unknown, settings?: unknown) =>
  POST(
    new Request("http://localhost/api/ttx", {
      method: "POST",
      body: JSON.stringify({ messages, settings }),
    }),
  );

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

    expect(model.doStreamCalls[0].toolChoice).toEqual({
      type: "tool",
      toolName: "generate_turn",
    });
    expect(model.doStreamCalls[0].reasoning).toBe("medium");
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

  it("forces the after_action_report tool once the exercise has ended", async () => {
    const model = mockToolCallModel("after_action_report", {});
    env.model = model;
    const ended = { ...turnInput, hours_elapsed: 72, scenario_status: "survived" };

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
