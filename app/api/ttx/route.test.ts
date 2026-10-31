import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import {
  APICallError,
  StreamProviderError,
  readUIMessageStream,
  simulateReadableStream,
  type UIMessageChunk,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AfterActionReport, TtxUIMessage } from "@/lib/ttx";

import { CAPTURE_HEADER } from "@/lib/debrief-capture";
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

const { GET, POST } = await import("./route");

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
    // The eval reads actual usage and the number of provider calls from the metadata.
    expect(last?.metadata).toEqual({ usage: { inputTokens: 1, outputTokens: 1 }, providerCalls: 1, schemaRetries: 0 });
  });

  it("retries once when the provider rejects a malformed turn before any output", async () => {
    const model = failingOnce(mockToolCallModel("generate_turn", turnInput), async () => {
      throw schemaSlipError();
    });
    env.model = model;

    const last = await lastMessage(await post([userMessage]));
    expect(model.doStreamCalls).toHaveLength(2);
    expect(last?.metadata).toMatchObject({ providerCalls: 2, schemaRetries: 1 });
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
    expect(last?.metadata).toMatchObject({ providerCalls: 2, schemaRetries: 1 });
    expect(last?.parts.find((p) => p.type === "tool-generate_turn")).toMatchObject({
      state: "output-available",
      output: turnInput,
    });
  });

  it("counts the SDK's rate-limit retries as provider calls, not schema retries", async () => {
    const model = failingOnce(mockToolCallModel("generate_turn", turnInput), async () => {
      throw new APICallError({
        message: "Rate limit reached on tokens per minute (TPM). Please try again in 1ms.",
        url: "https://api.groq.com/openai/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: { "retry-after-ms": "1" },
        isRetryable: true,
      });
    });
    env.model = model;

    const last = await lastMessage(await post([userMessage]));
    expect(last?.metadata).toMatchObject({ providerCalls: 2, schemaRetries: 0 });
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

});

describe("POST /api/ttx: the debrief", () => {
  const ended = { ...turnInput, hours_elapsed: 72, time_elapsed: "Hour 72", scenario_status: "complete" as const };
  const endedExercise: TtxUIMessage[] = [
    userMessage,
    {
      id: "a1",
      role: "assistant",
      parts: [{ type: "tool-generate_turn", toolCallId: "c1", state: "output-available", input: ended, output: ended }],
    },
    { id: "u2", role: "user", parts: [{ type: "text", text: "The exercise is over. Please prepare the debrief." }] },
  ];

  const passing: AfterActionReport = {
    summary: "Heat was the weak point.",
    went_well: ["You layered clothes early."],
    need_to_know: ["Your furnace needs power to run (from your household profile: gas furnace)."],
    do_better: [
      {
        action: "Put a sleeping bag on this week's shopping list.",
        evidence: "Hour 72: the cold apartment",
        why: "The apartment fell to 50°F with no other way to stay warm.",
      },
    ],
    supply_checklist: [],
  };
  /** Alex's embedded kit list (eval finding 16): fails the one-action check. */
  const kitListItem = {
    action:
      "Assemble a basic emergency kit that includes a sleeping bag or warm blanket, a battery‑powered NOAA radio, first‑aid supplies, a manual can opener, extra batteries, dust masks, plastic sheeting, duct tape, a whistle, and hand sanitizer.",
    evidence: "Hour 72: the inventory gaps",
    why: "You had few supplies.",
  };
  const kitList: AfterActionReport = { ...passing, do_better: [kitListItem] };

  /** Answers each debrief call with the next report, and records what it was asked. */
  const debriefModel = (reports: AfterActionReport[], onCall?: (call: number) => void) => {
    let call = 0;
    return new MockLanguageModelV4({
      doGenerate: async () => {
        onCall?.(call);
        const report = reports[Math.min(call++, reports.length - 1)];
        return {
          content: [{ type: "tool-call", toolCallId: `call-${call}`, toolName: "after_action_report", input: JSON.stringify(report) }],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 5, text: 5, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
  };
  const promptText = (model: MockLanguageModelV4, call: number) =>
    JSON.stringify(model.doGenerateCalls[call].prompt.filter((m) => m.role === "user"));

  it("checks a debrief and returns it when it passes the implemented checks", async () => {
    const model = debriefModel([passing]);
    env.model = model;

    const last = await lastMessage(await post(endedExercise));
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0].toolChoice).toEqual({ type: "tool", toolName: "after_action_report" });
    // Decision D8: a review of decisions, not a grade.
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain("Don't grade, score or give a verdict.");
    expect(last?.parts.find((p) => p.type === "tool-after_action_report")).toMatchObject({ state: "output-available", output: passing });
    expect(last?.metadata).toEqual({
      usage: { inputTokens: 10, outputTokens: 5 },
      providerCalls: 1,
      schemaRetries: 0,
      debriefRepairs: 0,
      debriefChecks: { passedImplementedChecks: true, failedFirst: [] },
    });
  });

  it("repairs a failing debrief once, telling the model exactly which checks failed", async () => {
    const model = debriefModel([kitList, passing]);
    env.model = model;

    const last = await lastMessage(await post(endedExercise));
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(promptText(model, 0)).not.toContain("failed these checks");
    const repair = promptText(model, 1);
    expect(repair).toContain("Your debrief failed these checks");
    expect(repair).toContain("action is a list rather than one action");
    expect(repair).toContain("YOUR PREVIOUS DEBRIEF (JSON)");
    expect(last?.parts.find((p) => p.type === "tool-after_action_report")).toMatchObject({ output: passing });
    expect(last?.metadata).toMatchObject({
      usage: { inputTokens: 20, outputTokens: 10 },
      providerCalls: 2,
      schemaRetries: 0,
      debriefRepairs: 1,
      debriefChecks: { passedImplementedChecks: true, failedFirst: [expect.stringContaining("action is a list")] },
    });
  });

  it("lets the repair drop a failing improvement and returns fewer than three", async () => {
    const model = debriefModel([{ ...passing, do_better: [...passing.do_better, kitListItem] }, passing]);
    env.model = model;

    const last = await lastMessage(await post(endedExercise));
    expect(promptText(model, 1)).toContain("You may drop a failing improvement instead of fixing it");
    const report = last?.parts.find((p) => p.type === "tool-after_action_report");
    expect(report).toMatchObject({ output: { do_better: passing.do_better } });
    expect(last?.metadata).toMatchObject({ debriefRepairs: 1, debriefChecks: { passedImplementedChecks: true } });
  });

  it("returns a recoverable error, not the debrief, when the repair still fails", async () => {
    const model = debriefModel([kitList, kitList]);
    env.model = model;

    const res = await post(endedExercise);
    const body = await res.text();
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(body).toContain("didn't pass ReadyState's checks, even after one repair");
    expect(body).not.toContain("tool-output-available");
    // The counters and both sets of failures still reach the eval, without the debrief.
    const start = body.split("\n").find((line) => line.includes('"type":"start"'));
    expect(JSON.parse(start!.slice(6)).messageMetadata).toMatchObject({
      providerCalls: 2,
      debriefRepairs: 1,
      debriefChecks: {
        passedImplementedChecks: false,
        failedFirst: [expect.stringContaining("action is a list")],
        stillFailing: [expect.stringContaining("action is a list")],
      },
    });
  });

  describe("omitting a kit-list improvement the repair kept", () => {
    const withKit: AfterActionReport = { ...passing, do_better: [...passing.do_better, kitListItem], supply_checklist: ["Manual can opener"] };

    it("drops it whole when everything else passes, leaves the checklist, and tells the participant", async () => {
      env.model = debriefModel([withKit, withKit]);

      const last = await lastMessage(await post(endedExercise));
      expect(last?.parts.find((p) => p.type === "tool-after_action_report")).toMatchObject({
        state: "output-available",
        output: { ...withKit, do_better: passing.do_better },
      });
      expect(last?.metadata).toMatchObject({
        debriefRepairs: 1,
        debriefChecks: {
          passedImplementedChecks: true,
          omittedImprovement: { action: kitListItem.action, checks: ["list-shaped"] },
        },
      });
    });

    it("still returns the recoverable error when another failure remains", async () => {
      const uncited = { ...withKit, need_to_know: [...withKit.need_to_know, "Floods are dangerous."] };
      env.model = debriefModel([uncited, uncited]);

      const body = await (await post(endedExercise)).text();
      expect(body).toContain("didn't pass ReadyState's checks, even after one repair");
      expect(body).not.toContain("tool-output-available");
      expect(body).not.toContain("omittedImprovement");
    });

    it("records the omission and the displayed debrief in the capture, with the repair still marked rejected", async () => {
      vi.stubEnv("READYSTATE_CAPTURE_DEBRIEF_DRAFTS", "1");
      env.model = debriefModel([withKit, withKit]);

      const last = await lastMessage(await post(endedExercise, undefined, { "content-type": "application/json", [CAPTURE_HEADER]: "1" }));
      const capture = last?.metadata?.debriefCapture;
      expect(capture?.drafts.map((d) => d.status)).toEqual(["rejected", "rejected"]);
      expect(capture?.omitted).toMatchObject({
        action: kitListItem.action,
        checks: ["list-shaped"],
        stillFailing: [expect.objectContaining({ check: "list-shaped", field: "do_better[1].action" })],
        report: { ...withKit, do_better: passing.do_better },
      });
      vi.unstubAllEnvs();
    });
  });

  it("ends the debrief briefing with the story facts, including invented equipment and power returning", async () => {
    const invented = {
      ...ended,
      narrative_response: "Power is restored but the central heating is slow to recover. You find a space heater in the hall closet and plug it in.",
    };
    const exercise = endedExercise.map((message) =>
      message.id === "a1"
        ? { ...message, parts: [{ type: "tool-generate_turn" as const, toolCallId: "c1", state: "output-available" as const, input: invented, output: invented }] }
        : message,
    );
    const model = debriefModel([passing]);
    env.model = model;

    await (await post(exercise)).text();
    const prompt = promptText(model, 0);
    expect(prompt).toContain("STORY FACTS");
    expect(prompt).toContain("Power returned at Hour 72");
    expect(prompt).toContain("The space heater, first at Hour 72");
    expect(prompt).toContain("Don't credit them with anything else, such as coordinating with building staff");
  });

  describe("draft capture", () => {
    const capturing = { "content-type": "application/json", [CAPTURE_HEADER]: "1" };
    const startMetadata = (body: string) => JSON.parse(body.split("\n").find((line) => line.includes('"type":"start"'))!.slice(6)).messageMetadata;
    afterEach(() => vi.unstubAllEnvs());

    it("is off by default, and when only one side asks for it", async () => {
      env.model = debriefModel([kitList, kitList]);
      expect(startMetadata(await (await post(endedExercise, undefined, capturing)).text())).not.toHaveProperty("debriefCapture");
      vi.stubEnv("READYSTATE_CAPTURE_DEBRIEF_DRAFTS", "1");
      expect(startMetadata(await (await post(endedExercise)).text())).not.toHaveProperty("debriefCapture");
    });

    it("sends both rejected drafts, each failed check with its field and match, and the evidence without the baseline", async () => {
      vi.stubEnv("READYSTATE_CAPTURE_DEBRIEF_DRAFTS", "1");
      env.model = debriefModel([kitList, kitList]);

      const body = await (await post(endedExercise, undefined, capturing)).text();
      expect(body).toContain("didn't pass ReadyState's checks");
      const capture = startMetadata(body).debriefCapture;
      expect(capture.drafts.map((d: { attempt: string; status: string }) => [d.attempt, d.status])).toEqual([
        ["first", "rejected"],
        ["repair", "rejected"],
      ]);
      expect(capture.drafts[0].report).toEqual(kitList);
      expect(capture.drafts[0].failedChecks[0]).toMatchObject({ check: "list-shaped", field: "do_better[0].action", matched: kitListItem.action });
      expect(capture.drafts[0].usage).toEqual({ inputTokens: 10, outputTokens: 5 });
      expect(capture.evidence.hours).toEqual([72]);
      expect(capture.evidence.log).toContain("LATEST TURN (Hour 72");
      expect(JSON.stringify(capture)).not.toContain("live in [Location 1]");
    });

    it("answers the eval's preflight without a model call, and never in hosted mode", async () => {
      const preflight = async () => (await GET(new Request("http://localhost/api/ttx", { headers: { [CAPTURE_HEADER]: "1" } }))).json();
      expect(await preflight()).toEqual({ captureDebriefDrafts: false });
      vi.stubEnv("READYSTATE_CAPTURE_DEBRIEF_DRAFTS", "1");
      expect(await preflight()).toEqual({ captureDebriefDrafts: true });
      expect(await (await GET(new Request("http://localhost/api/ttx"))).json()).toEqual({ captureDebriefDrafts: false });
      env.mode = "hosted";
      expect(await preflight()).toEqual({ captureDebriefDrafts: false });
      env.mode = "self-hosted";
    });

    it("marks an accepted draft as accepted", async () => {
      vi.stubEnv("READYSTATE_CAPTURE_DEBRIEF_DRAFTS", "1");
      env.model = debriefModel([kitList, passing]);
      const last = await lastMessage(await post(endedExercise, undefined, capturing));
      expect(last?.metadata?.debriefCapture?.drafts.map((d) => d.status)).toEqual(["rejected", "accepted"]);
    });
  });

  it("skips the repair when too little of the time budget is left", async () => {
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    // The first attempt takes 40 of the 55 seconds.
    const model = debriefModel([kitList], () => now.mockReturnValue(start + 40_000));
    env.model = model;

    const body = await (await post(endedExercise)).text();
    now.mockRestore();
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(body).toContain("there wasn't time before the server's limit");
    expect(body).not.toContain("tool-output-available");
  });

  it("explains a request that ran out of time", async () => {
    env.model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      },
    });
    const body = await (await post(endedExercise)).text();
    expect(body).toContain("took too long");
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
