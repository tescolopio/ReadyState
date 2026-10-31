import { describe, expect, it } from "vitest";

import { ALL_CASES, BATCHES } from "./cases";
import { JUDGE_INSTRUCTIONS, MAX_OUTPUT_TOKENS, batchPrompt, corrupt, estimateInputTokens, formProblems, type Judgment } from "./judge";
import { LABELS } from "./labels";
import { score, summarize } from "./score";

describe("the G11 case set", () => {
  it("labels every case, with unique opaque ids", () => {
    expect(new Set(ALL_CASES.map((c) => c.id)).size).toBe(ALL_CASES.length);
    expect(Object.keys(LABELS).sort()).toEqual(ALL_CASES.map((c) => c.id).sort());
    for (const { id } of ALL_CASES) expect(id).toMatch(/^C\d\d$/);
  });

  it("includes defects, accurate rewrites, paraphrases and ambiguous cases, in both splits", () => {
    const kinds = Object.values(LABELS).map((label) => label.kind);
    expect(kinds).toEqual(expect.arrayContaining(["defect", "accurate", "ambiguous"]));
    expect(Object.values(LABELS).some((label) => label.type.includes("paraphrase"))).toBe(true);
    for (const split of ["tuning", "reserved"]) expect(ALL_CASES.filter((c) => c.split === split).length).toBeGreaterThanOrEqual(7);
  });
});

describe("the judge's prompt", () => {
  const prompts = BATCHES.map(batchPrompt);

  it("never contains a manual label, a defect type or a split", () => {
    for (const text of [JUDGE_INSTRUCTIONS, ...prompts]) {
      for (const label of Object.values(LABELS)) {
        expect(text).not.toContain(label.source);
        expect(text).not.toContain(label.type);
      }
      expect(text).not.toMatch(/\b(tuning|reserved)\b/);
    }
  });

  it("gives story batches the log and the note, and the household-and-guidance batch neither", () => {
    const [storyA, storyB, other] = prompts;
    for (const text of [storyA, storyB]) {
      expect(text).toContain("[Hour 72 outcome]");
      expect(text).toContain("[Response after Hour 60]");
      expect(text).toContain("STORY FACTS");
    }
    expect(other).not.toContain("EXERCISE LOG");
    expect(other).not.toContain("STORY FACTS");
    expect(other).toContain("[Guidance: CO detectors (battery or battery-backup) near sleeping areas. (CDC)]");
    expect(other).toContain("[Baseline: Has]");
    expect(storyA).not.toContain("APPROVED GUIDANCE");
  });

  it("leaves offered choices out of the log, and corrupts only story B's note", () => {
    const [storyA, storyB] = prompts;
    expect(storyA).not.toContain("(a) Return to your apartment now");
    expect(storyA).toContain("Power returned at Hour 60");
    expect(storyB).toContain("Power returned at Hour 54");
    expect(corrupt("Power returned at Hour 60: x")).toBe("Power returned at Hour 54: x");
  });

  it("keeps each call under Groq's 8k tokens a minute, with the answer's allowance", () => {
    // About four characters a token, plus about 450 for the tool schema.
    for (const text of prompts) expect(estimateInputTokens(text) + MAX_OUTPUT_TOKENS).toBeLessThan(8000);
  });
});

describe("checking and scoring a judgment", () => {
  const batch = BATCHES[0];
  const judgment = (verdict: (id: string) => Judgment["verdicts"][number]["verdict"]): Judgment => ({
    story_facts_conflicts: [],
    verdicts: batch.cases.map(({ id, claim }) => ({ id, claim, basis: "story", verdict: verdict(id), involves_forecast: false, evidence: ["Hour 60 situation"], explanation: "x" })),
  });

  it("reports form problems", () => {
    const bad = judgment(() => "supported");
    bad.verdicts[0].claim += " (paraphrased)";
    bad.verdicts.pop();
    expect(formProblems(batch, bad)).toEqual([`${batch.cases[0].id}: claim not quoted exactly`, `${batch.cases.at(-1)!.id}: no verdict`]);
  });

  it("keeps missed defects, false positives and unclear verdicts apart", () => {
    const allSupported = summarize(score([judgment(() => "supported")]));
    expect(allSupported.missed.map((c) => c.id).sort()).toEqual(batch.cases.filter((c) => LABELS[c.id].kind === "defect").map((c) => c.id).sort());
    expect(allSupported.falsePositives).toEqual([]);
    const allContradicted = summarize(score([judgment(() => "contradicted")]));
    expect(allContradicted.falsePositives.map((c) => c.id).sort()).toEqual(batch.cases.filter((c) => LABELS[c.id].kind === "accurate").map((c) => c.id).sort());
    expect(summarize(score([judgment(() => "unclear")])).unclear.length).toBe(batch.cases.filter((c) => LABELS[c.id].kind !== "ambiguous").length);
  });
});
