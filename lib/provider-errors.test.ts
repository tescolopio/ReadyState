import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";

import { describeProviderError } from "@/lib/provider-errors";

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

  it("falls back to a generic message for anything else", () => {
    expect(describeProviderError(new Error("boom"), "self-hosted")).toBe(
      "Something went wrong generating this turn. Please try again.",
    );
  });
});
