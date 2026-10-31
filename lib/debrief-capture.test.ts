import { afterEach, describe, expect, it, vi } from "vitest";

import { CAPTURE_HEADER, briefingWithoutBaseline, captureEnabled } from "@/lib/debrief-capture";

describe("captureEnabled", () => {
  const request = (headers: Record<string, string> = { [CAPTURE_HEADER]: "1" }) => new Request("http://localhost/api/ttx", { headers });
  afterEach(() => vi.unstubAllEnvs());

  it("needs the server flag and the request header", () => {
    expect(captureEnabled(request(), "self-hosted")).toBe(false);
    vi.stubEnv("READYSTATE_CAPTURE_DEBRIEF_DRAFTS", "1");
    expect(captureEnabled(request({}), "self-hosted")).toBe(false);
    expect(captureEnabled(request(), "self-hosted")).toBe(true);
  });

  it("is never on in hosted mode", () => {
    vi.stubEnv("READYSTATE_CAPTURE_DEBRIEF_DRAFTS", "1");
    expect(captureEnabled(request(), "hosted")).toBe(false);
  });
});

describe("briefingWithoutBaseline", () => {
  it("drops the household baseline, even one with blank lines", () => {
    const briefing = "HOUSEHOLD BASELINE (sanitized):\nPeople: 1 adult.\n\nHas: a radio.\n\nEXERCISE LOG (earlier turns, condensed):\n- Hour 0: …\n\nLATEST TURN (Hour 6, hours_elapsed 6):\nOutcome: …";
    expect(briefingWithoutBaseline(briefing)).toBe("EXERCISE LOG (earlier turns, condensed):\n- Hour 0: …\n\nLATEST TURN (Hour 6, hours_elapsed 6):\nOutcome: …");
    expect(briefingWithoutBaseline("HOUSEHOLD BASELINE (sanitized):\nPeople: 1 adult.")).toBe("");
  });
});
