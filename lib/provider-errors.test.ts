import { APICallError, RetryError, StreamProviderError } from "ai";
import { describe, expect, it } from "vitest";

import { describeProviderError, isSchemaSlip, retryAfterSeconds } from "@/lib/provider-errors";

const apiError = (statusCode: number, responseBody = "", responseHeaders: Record<string, string> = {}) =>
  new APICallError({
    message: "Provider error",
    url: "https://api.example.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody,
    responseHeaders,
  });

// Shaped like Groq's real daily-limit response, including the account id it carries.
const dailyLimit = apiError(
  429,
  '{"error":{"message":"Rate limit reached for model `openai/gpt-oss-120b` in organization `org_secret123` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199252, Requested 1386. Please try again in 4m35.616s."}}',
);

describe("describeProviderError", () => {
  it("explains a daily limit with the wait time, unwrapped from retries", () => {
    const wrapped = new RetryError({ message: "Failed after 3 attempts", reason: "maxRetriesExceeded", errors: [dailyLimit] });
    expect(describeProviderError(wrapped, "self-hosted")).toBe(
      "The model provider's daily usage limit has been reached. Try again in about 5 minutes or choose another model or provider in Settings.",
    );
  });

  it("never passes through the provider's raw text", () => {
    expect(describeProviderError(dailyLimit, "hosted")).not.toMatch(/org_|gpt-oss|200000/);
    expect(describeProviderError(dailyLimit, "hosted")).not.toContain("Settings");
  });

  it("explains a per-minute limit from the retry-after header", () => {
    expect(describeProviderError(apiError(429, "", { "retry-after": "12" }), "self-hosted")).toBe(
      "The model provider is limiting requests right now. Wait about 12 seconds and submit again.",
    );
  });

  it("says a few seconds for a sub-second wait, as Groq sends in milliseconds", () => {
    expect(describeProviderError(apiError(429, "on tokens per minute (TPM). Please try again in 277.499999ms."), "hosted")).toBe(
      "The model provider is limiting requests right now. Wait a few seconds and submit again.",
    );
  });

  it("points self-hosters at their key, model or the provider", () => {
    expect(describeProviderError(apiError(401), "self-hosted")).toContain("rejected the API key");
    expect(describeProviderError(apiError(404), "self-hosted")).toContain("doesn't recognize the selected model");
    expect(describeProviderError(apiError(503), "hosted")).toBe("The model provider is having problems. Please try again shortly.");
  });

  it("explains a malformed turn from a smaller model", () => {
    const invalid = apiError(400, '{"error":{"message":"Tool call validation failed: parameters for tool generate_turn did not match schema"}}');
    expect(describeProviderError(invalid, "self-hosted")).toBe(
      "The model returned an incomplete turn. Submit your response again; if it keeps happening, choose a larger model in Settings.",
    );
  });

  it("recognizes a malformed turn reported mid-stream", () => {
    const midStream = new StreamProviderError({
      message: "tool call validation failed: parameters for tool generate_turn did not match schema",
      code: "tool_use_failed",
      statusCode: 400,
    });
    expect(isSchemaSlip(midStream)).toBe(true);
    expect(describeProviderError(midStream, "hosted")).toBe("The model returned an incomplete turn. Submit your response again.");
    expect(isSchemaSlip(apiError(400, "context length exceeded"))).toBe(false);
  });

  it("reads the wait from the message, then the retry-after header", () => {
    expect(retryAfterSeconds(dailyLimit)).toBeCloseTo(275.616);
    expect(retryAfterSeconds(apiError(429, "", { "retry-after": "12" }))).toBe(12);
    expect(retryAfterSeconds(apiError(429, "Please try again in 277.499999ms."))).toBeCloseTo(0.2775);
    expect(retryAfterSeconds(apiError(429, "Please try again in 1.065s."))).toBeCloseTo(1.065);
    expect(retryAfterSeconds(apiError(429))).toBeUndefined();
    expect(retryAfterSeconds(new Error("boom"))).toBeUndefined();
  });

  it("falls back to a generic message for anything else", () => {
    expect(describeProviderError(new Error("boom"), "self-hosted")).toBe(
      "Something went wrong generating this turn. Please try again.",
    );
  });
});
