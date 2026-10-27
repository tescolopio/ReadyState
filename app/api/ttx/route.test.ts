import { readUIMessageStream, simulateReadableStream, type UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TtxUIMessage } from "@/lib/ttx";

const groq = vi.hoisted(() => ({ model: null as unknown }));
vi.mock("@/lib/groq", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/groq")>()),
  getGroqModel: () => groq.model,
}));

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

const post = (messages: unknown) =>
  POST(
    new Request("http://localhost/api/ttx", {
      method: "POST",
      body: JSON.stringify({ messages }),
    }),
  );

const userMessage: TtxUIMessage = {
  id: "u1",
  role: "user",
  parts: [{ type: "text", text: "[Person 1], [Large Dog], live in [Location 1]." }],
};

describe("POST /api/ttx", () => {
  beforeEach(() => {
    groq.model = null;
  });

  it("returns 500 when GROQ_API_KEY is missing", async () => {
    const res = await post([userMessage]);
    expect(res.status).toBe(500);
  });

  it("rejects invalid payloads", async () => {
    groq.model = mockToolCallModel("generate_turn", turnInput);
    const res = await post("nope");
    expect(res.status).toBe(400);
  });

  it("forces the generate_turn tool and streams structured turn data", async () => {
    const model = mockToolCallModel("generate_turn", turnInput);
    groq.model = model;

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
    groq.model = model;
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
