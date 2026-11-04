import { afterEach, describe, expect, it, vi } from "vitest";

import { exerciseHours } from "./exercise-clock";
import { TARGET_DURATION_HOURS } from "./ttx";

describe("exerciseHours", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is the default clock without the eval variable", () => {
    vi.stubEnv("READYSTATE_EVAL_TARGET_HOURS", "");
    expect(exerciseHours("self-hosted")).toBe(TARGET_DURATION_HOURS);
  });

  it("uses a longer clock a local eval sets", () => {
    vi.stubEnv("READYSTATE_EVAL_TARGET_HOURS", "168");
    vi.stubEnv("VERCEL", "");
    expect(exerciseHours("self-hosted")).toBe(168);
  });

  it("ignores the variable in hosted mode and on Vercel", () => {
    vi.stubEnv("READYSTATE_EVAL_TARGET_HOURS", "168");
    expect(exerciseHours("hosted")).toBe(TARGET_DURATION_HOURS);
    vi.stubEnv("VERCEL", "1");
    expect(exerciseHours("self-hosted")).toBe(TARGET_DURATION_HOURS);
  });

  it("ignores values that aren't a whole number above the default", () => {
    vi.stubEnv("VERCEL", "");
    for (const value of ["24", "72", "168.5", "-200", "a week"]) {
      vi.stubEnv("READYSTATE_EVAL_TARGET_HOURS", value);
      expect(exerciseHours("self-hosted"), value).toBe(TARGET_DURATION_HOURS);
    }
  });
});
