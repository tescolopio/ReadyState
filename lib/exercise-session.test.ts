import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exerciseChat, resendLast, resetExercise, sendToExercise } from "@/lib/exercise-session";
import { prepareReview } from "@/lib/outgoing-review";
import { useSettingsStore } from "@/store/useSettingsStore";

/** Each request's JSON body, answered with a provider failure so the chat ends in an error. */
const requests: { messages: { parts: { text: string }[] }[]; settings?: unknown }[] = [];

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ error: "The model provider is having problems." }), { status: 502 });
    }),
  );
});
afterEach(() => {
  resetExercise();
  useSettingsStore.getState().setSettings(null);
  vi.unstubAllGlobals();
});

const texts = (request: (typeof requests)[number]) => request.messages.map((m) => m.parts.map((p) => p.text).join(""));

describe("sendToExercise and resendLast", () => {
  it("retries with the approved message and the Settings it was sent with, not changed ones", async () => {
    useSettingsStore.getState().setSettings({ provider: "groq" });
    await sendToExercise("[Person 1] checks the furnace.");
    expect(exerciseChat.status).toBe("error");

    useSettingsStore.getState().setSettings({ provider: "google", apiKey: "changed" });
    await resendLast();

    expect(requests).toHaveLength(2);
    expect(texts(requests[1])).toEqual(["[Person 1] checks the furnace."]);
    expect(requests[1].settings).toEqual({ provider: "groq" });
    // The failed message is sent again, not appended a second time.
    expect(exerciseChat.messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("sends nothing while a message is only prepared for review", () => {
    const review = prepareReview("response", (mask) => mask("Call Jamie at 303-555-0142."), {}, ["Jamie"]);
    expect(review.text).toBe("Call [Person 1] at [Phone 1].");
    expect(fetch).not.toHaveBeenCalled();
    expect(exerciseChat.messages).toEqual([]);
  });

  it("keeps retry credentials separate from conversation history and clears them on reset", async () => {
    const settings = { provider: "groq" as const, apiKey: "synthetic-retry-key" };
    useSettingsStore.getState().setSettings(settings);
    await sendToExercise("[Person 1] checks the furnace.");
    settings.apiKey = "synthetic-changed-key";
    await resendLast();

    expect(requests[1].settings).toEqual({ provider: "groq", apiKey: "synthetic-retry-key" });
    expect(JSON.stringify(exerciseChat.messages)).not.toContain("synthetic-retry-key");
    expect(JSON.stringify(requests[1].messages)).not.toContain("synthetic-retry-key");

    resetExercise();
    useSettingsStore.getState().setSettings(null);
    await sendToExercise("We check the pipes.");
    expect(requests[2].settings).toBeUndefined();
    expect(texts(requests[2])).toEqual(["We check the pipes."]);
  });
});
