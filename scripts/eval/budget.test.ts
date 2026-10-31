import { describe, expect, it } from "vitest";

import { MAX_PROVIDER_CALLS_PER_REQUEST, canStart, capFor, chargeRequest, overAllowance } from "./budget";

const ALLOWANCE = 8_000;

describe("the G6 budget", () => {
  it("counts every retry layer in a request's worst case: 2 attempts × 3 SDK tries × 2 middleware calls", () => {
    expect(MAX_PROVIDER_CALLS_PER_REQUEST).toBe(12);
  });

  it("charges each call its reported usage, and a call without usage its full allowance", () => {
    expect(chargeRequest([{ inputTokens: 4_600, outputTokens: 1_100 }], ALLOWANCE)).toBe(5_700);
    // A schema slip rejected before output, then the call that streamed.
    expect(chargeRequest([{ rejected: true, status: 400 }, { inputTokens: 4_600, outputTokens: 1_100 }], ALLOWANCE)).toBe(13_700);
    // A discarded mid-stream attempt reports nothing.
    expect(chargeRequest([{}, { inputTokens: 4_600, outputTokens: 1_100 }], ALLOWANCE)).toBe(13_700);
  });

  it("charges a request with no per-call metadata its worst case", () => {
    expect(chargeRequest(undefined, ALLOWANCE)).toBe(96_000);
  });

  it("flags a call over its allowance, since the worst-case bound then fails", () => {
    expect(overAllowance([{ inputTokens: 6_500, outputTokens: 1_600 }, { inputTokens: 5_000, outputTokens: 1_000 }], ALLOWANCE)).toHaveLength(1);
    expect(overAllowance([{ rejected: true }], ALLOWANCE)).toEqual([]);
  });

  it("starts a request only when its whole worst case fits", () => {
    expect(canStart(56_000, 152_000, ALLOWANCE)).toBe(true);
    expect(canStart(56_001, 152_000, ALLOWANCE)).toBe(false);
    expect(canStart(0, 72_000, ALLOWANCE)).toBe(false);
  });

  it("sizes the cap so all 8 live turns can start: 7 single calls plus the last request's worst case", () => {
    expect(capFor(8, ALLOWANCE)).toBe(152_000);
    // Under that cap, 8 one-call requests at their full allowance all start.
    let charged = 0;
    for (let request = 0; request < 8; request++) {
      expect(canStart(charged, capFor(8, ALLOWANCE), ALLOWANCE)).toBe(true);
      charged += chargeRequest([{}], ALLOWANCE);
    }
  });
});
