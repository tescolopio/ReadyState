import { describe, expect, it } from "vitest";

import { MAX_PROVIDER_CALLS_PER_REQUEST, chargeRequest, overBound } from "./budget";

const reserve = { inputBound: 26_000, maxOutputTokens: 2_500, reserved: 28_500 };

describe("the G6 budget", () => {
  it("counts every retry layer in a request's worst case: 2 attempts × 3 SDK tries × 2 middleware calls", () => {
    expect(MAX_PROVIDER_CALLS_PER_REQUEST).toBe(12);
  });

  it("charges each call its reported usage, and a call without usage the whole reserve the server enforced", () => {
    expect(chargeRequest([{ ...reserve, inputTokens: 4_600, outputTokens: 1_100 }], 0, 0)).toBe(5_700);
    // A schema slip rejected before output, then the call that streamed.
    expect(chargeRequest([{ ...reserve, rejected: true, status: 400 }, { ...reserve, inputTokens: 4_600, outputTokens: 1_100 }], 0, 0)).toBe(34_200);
    // A discarded mid-stream attempt reports nothing.
    expect(chargeRequest([reserve, { ...reserve, inputTokens: 4_600, outputTokens: 1_100 }], 0, 0)).toBe(34_200);
    // Usage is never guessed: input alone isn't a reported total.
    expect(chargeRequest([{ ...reserve, inputTokens: 4_600 }], 0, 0)).toBe(28_500);
  });

  it("charges a call without usage or a reserve, and a request without per-call metadata, the given fallbacks", () => {
    expect(chargeRequest([{}], 8_000, 0)).toBe(8_000);
    expect(chargeRequest(undefined, 8_000, 61_000)).toBe(61_000);
  });

  it("flags a call that reported more than the server enforced", () => {
    expect(overBound([{ ...reserve, inputTokens: 26_001, outputTokens: 10 }])).toHaveLength(1);
    expect(overBound([{ ...reserve, inputTokens: 5_000, outputTokens: 2_501 }])).toHaveLength(1);
    expect(overBound([{ ...reserve, inputTokens: 5_000, outputTokens: 2_500 }, { ...reserve, rejected: true }, {}])).toEqual([]);
  });
});
