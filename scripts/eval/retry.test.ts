import { describe, expect, it } from "vitest";

import { describeProviderError } from "@/lib/provider-errors";
import { APICallError } from "ai";

import { MAX_RATE_LIMIT_WAITS, rateLimitWait, sendWithRetries, type SendOutcome } from "./retry";

/** The app's message for a Groq per-minute limit with the given provider text. */
const appMessage = (providerText: string) =>
  describeProviderError(
    new APICallError({ message: providerText, url: "https://api.groq.com", requestBodyValues: {}, statusCode: 429 }),
    "self-hosted",
  );

describe("rateLimitWait", () => {
  it("waits a few seconds for Groq's fractional-millisecond hint (eval finding 14)", () => {
    expect(rateLimitWait(appMessage("on tokens per minute (TPM). Please try again in 277.499999ms."))).toBe(5000);
  });

  it("waits the stated seconds or minutes, plus a second", () => {
    expect(rateLimitWait(appMessage("on tokens per minute (TPM). Please try again in 11.2s."))).toBe(13_000);
    expect(rateLimitWait(appMessage("on tokens per minute (TPM). Please try again in 2m3s."))).toBe(181_000);
  });

  it("waits 30 seconds when the provider gave no wait", () => {
    expect(rateLimitWait(appMessage("on tokens per minute (TPM)."))).toBe(30_000);
  });

  it("doesn't wait out a daily limit or other errors", () => {
    expect(rateLimitWait(appMessage("on tokens per day (TPD). Please try again in 4m35s."))).toBeUndefined();
    expect(rateLimitWait("The model provider is having problems. Please try again shortly.")).toBeUndefined();
  });
});

describe("sendWithRetries", () => {
  const limited = appMessage("on tokens per minute (TPM). Please try again in 277.499999ms.");
  const noSleep = async () => {};

  /** A fake server that replies with each outcome in turn and records what it was sent. */
  const server = (outcomes: SendOutcome<string>[]) => {
    const messages = ["baseline", "turn 1", "action 1"];
    const seen: string[][] = [];
    let call = 0;
    return {
      seen,
      send: async () => {
        seen.push([...messages]);
        return outcomes[Math.min(call++, outcomes.length - 1)];
      },
    };
  };

  it("resumes after a rate limit with the identical request, so no turn is lost or repeated", async () => {
    const fake = server([{ error: limited }, { message: "turn 2" }]);
    const notes: string[] = [];
    const result = await sendWithRetries(fake.send, { sleep: noSleep, notes, label: "Call 10" });

    expect(result).toMatchObject({ message: "turn 2", attempts: 2, waitedMs: 5000 });
    expect(fake.seen).toEqual([
      ["baseline", "turn 1", "action 1"],
      ["baseline", "turn 1", "action 1"],
    ]);
    expect(notes).toEqual(["Call 10: rate limited, waited 5 s"]);
  });

  it(`gives up after ${MAX_RATE_LIMIT_WAITS} waits`, async () => {
    const fake = server([{ error: limited }]);
    const result = await sendWithRetries(fake.send, { sleep: noSleep, notes: [], label: "Call 1" });
    expect(result.error).toBe(limited);
    expect(result.attempts).toBe(MAX_RATE_LIMIT_WAITS + 1);
  });

  it("resubmits an incomplete turn once", async () => {
    const incomplete = "The model returned an incomplete turn. Submit your response again.";
    const twice = server([{ error: incomplete }, { error: incomplete }, { message: "never reached" }]);
    const result = await sendWithRetries(twice.send, { sleep: noSleep, notes: [], label: "Call 1" });
    expect(result).toMatchObject({ error: incomplete, attempts: 2 });
  });

  it("sends once, with no wait or resubmission, for a budgeted run", async () => {
    const incomplete = "The model returned an incomplete turn. Submit your response again.";
    for (const error of [limited, incomplete]) {
      const fake = server([{ error }, { message: "never reached" }]);
      const notes: string[] = [];
      const result = await sendWithRetries(fake.send, { sleep: noSleep, notes, label: "Call 1", maxWaits: 0, resubmit: false });
      expect(result).toMatchObject({ error, attempts: 1 });
      expect(notes).toEqual([]);
    }
  });
});
