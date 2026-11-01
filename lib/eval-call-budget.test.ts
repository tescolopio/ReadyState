import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EVAL_BUDGET_HEADER, EVAL_MAX_OUTPUT_HEADER, INPUT_OVERHEAD_TOKENS, evalCallBudget, inputBound } from "./eval-call-budget";

const request = (headers: Record<string, string>) => new Request("http://localhost/api/ttx", { headers });
const both = { [EVAL_BUDGET_HEADER]: "152000", [EVAL_MAX_OUTPUT_HEADER]: "2500" };

describe("evalCallBudget", () => {
  beforeEach(() => {
    vi.stubEnv("READYSTATE_EVAL_BUDGET", "1");
    vi.stubEnv("VERCEL", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("reads the remaining budget and the output limit on a local server with the flag", () => {
    expect(evalCallBudget(request(both), "self-hosted")).toEqual({ remaining: 152_000, maxOutputTokens: 2_500 });
  });

  it("is off without the server's flag, in hosted mode and on Vercel", () => {
    expect(evalCallBudget(request(both), "hosted")).toBeNull();
    vi.stubEnv("VERCEL", "1");
    expect(evalCallBudget(request(both), "self-hosted")).toBeNull();
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("READYSTATE_EVAL_BUDGET", "");
    expect(evalCallBudget(request(both), "self-hosted")).toBeNull();
  });

  it("is off unless both headers are whole numbers, with an output limit above zero", () => {
    for (const headers of [
      { [EVAL_BUDGET_HEADER]: "152000" },
      { ...both, [EVAL_BUDGET_HEADER]: "-1" },
      { ...both, [EVAL_BUDGET_HEADER]: "1e6" },
      { ...both, [EVAL_MAX_OUTPUT_HEADER]: "0" },
    ]) {
      expect(evalCallBudget(request(headers), "self-hosted"), JSON.stringify(headers)).toBeNull();
    }
    // A spent budget is still a budget: every call is then refused.
    expect(evalCallBudget(request({ ...both, [EVAL_BUDGET_HEADER]: "0" }), "self-hosted")).toEqual({ remaining: 0, maxOutputTokens: 2_500 });
  });
});

describe("inputBound", () => {
  it("counts the prompt and tools as JSON in UTF-8 bytes, plus the overhead", () => {
    const prompt = [{ role: "user", content: [{ type: "text", text: "50°F, no heat" }] }];
    const tools = [{ type: "function", name: "generate_turn", inputSchema: { type: "object" } }];
    expect(inputBound({ prompt, tools })).toBe(
      Buffer.byteLength(JSON.stringify(prompt)) + Buffer.byteLength(JSON.stringify(tools)) + INPUT_OVERHEAD_TOKENS,
    );
    // "°" is two bytes, so the bound is over the character count.
    expect(inputBound({ prompt })).toBeGreaterThan(JSON.stringify(prompt).length + 2 + INPUT_OVERHEAD_TOKENS);
  });
});
