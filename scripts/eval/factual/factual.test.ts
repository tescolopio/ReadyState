import { describe, expect, it } from "vitest";

import { ALL_CASES, BATCHES, type Batch } from "./cases";
import {
  JUDGE_INSTRUCTIONS,
  MAX_OUTPUT_TOKENS,
  batchPrompt,
  checkNote,
  derivedVerdict,
  estimateInputTokens,
  noteLines,
  validate,
  type JudgedAssertion,
  type JudgedClaim,
  type Judgment,
} from "./judge";
import { LABELS } from "./labels";
import { score, summarize } from "./score";

describe("the G11 case set", () => {
  it("labels every case, with unique opaque ids", () => {
    expect(new Set(ALL_CASES.map((c) => c.id)).size).toBe(ALL_CASES.length);
    expect(Object.keys(LABELS).sort()).toEqual(ALL_CASES.map((c) => c.id).sort());
    for (const { id } of ALL_CASES) expect(id).toMatch(/^C\d\d$/);
  });

  it("keeps the 21 Alex cases as development, and reserves new cases from other households", () => {
    expect(ALL_CASES.filter((c) => c.set === "development").map((c) => c.household)).toEqual(Array(21).fill("alex"));
    const reserved = ALL_CASES.filter((c) => c.set === "reserved");
    expect(new Set(reserved.map((c) => c.household))).toEqual(new Set(["charlotte", "priya"]));
    const kinds = reserved.map((c) => LABELS[c.id].kind);
    for (const kind of ["defect", "accurate", "ambiguous"]) expect(kinds).toContain(kind);
  });

  it("includes mixed reserved claims, each naming its one false detail, which appears in the claim", () => {
    const mixed = ALL_CASES.filter((c) => c.set === "reserved" && LABELS[c.id].type.startsWith("mixed"));
    expect(mixed.length).toBeGreaterThanOrEqual(5);
    for (const { id, claim } of mixed) expect(claim.toLowerCase()).toContain(LABELS[id].falseDetail!.toLowerCase());
  });
});

describe("the judge's prompt", () => {
  const prompts = BATCHES.map((batch) => ({ batch, ...batchPrompt(batch) }));

  it("never contains a manual label, a defect type, a source note or a case set", () => {
    for (const text of [JUDGE_INSTRUCTIONS, ...prompts.map((p) => p.text)]) {
      for (const label of Object.values(LABELS)) {
        expect(text).not.toContain(label.source);
        expect(text).not.toContain(label.type);
      }
      expect(text).not.toMatch(/\b(development|reserved|tuning)\b/);
    }
  });

  it("gives story batches the log and numbered note lines, and household-and-guidance batches neither", () => {
    for (const { batch, text, noteRefs } of prompts) {
      if (batch.evidence === "story") {
        expect(text).toContain("EXERCISE LOG");
        expect(text).toMatch(/\[Response after Hour \d+\]/);
        expect(noteRefs.length).toBeGreaterThan(1);
        expect(text).not.toContain("APPROVED GUIDANCE");
      } else {
        expect(text).not.toContain("EXERCISE LOG");
        expect(text).not.toContain("STORY FACTS");
        expect(text).toContain("[Guidance 1]");
        expect(text).toContain("[Baseline: Has]");
      }
    }
  });

  it("leaves out only the hours each batch names, keeping every response", () => {
    for (const { batch, text } of prompts.filter((p) => p.batch.evidence === "story")) {
      for (const hour of batch.omitHours ?? []) expect(text, `${batch.name} Hour ${hour}`).not.toContain(`[Hour ${hour} outcome]`);
      expect(text).toContain(`Outcomes and situations for Hours ${batch.omitHours!.join(", ")} are omitted`);
    }
    const priyaA = prompts.find((p) => p.batch.name === "priya story A")!.text;
    expect(priyaA).toContain("[Response after Hour 30]");
  });

  it("leaves offered choices out of the log", () => {
    const charlotte = prompts.find((p) => p.batch.name === "charlotte story B")!.text;
    expect(charlotte).toContain("[Hour 66 situation]");
    expect(charlotte).not.toContain("They suggest three options");
    const priya = prompts.find((p) => p.batch.name === "priya story A")!.text;
    expect(priya).not.toContain("Options include");
  });

  it("corrupts exactly one note line in each corrupted batch", () => {
    const alex = noteLines(BATCHES.find((b) => b.name === "alex story B")!);
    expect(alex.lines[alex.corrupted!]).toContain("Power returned at Hour 54");
    const charlotte = noteLines(BATCHES.find((b) => b.name === "charlotte story B")!);
    expect(charlotte.lines[charlotte.corrupted!]).toBe("Power returned at Hour 48.");
    expect(noteLines(BATCHES.find((b) => b.name === "charlotte story A")!).corrupted).toBeUndefined();
  });

  it("keeps every call under Groq's 8k tokens a minute, with the answer's allowance", () => {
    for (const { batch, text } of prompts) expect(estimateInputTokens(text) + MAX_OUTPUT_TOKENS, batch.name).toBeLessThan(8000);
  });
});

const batch = (name: string) => BATCHES.find((b) => b.name === name)!;
const assertion = (verdict: JudgedAssertion["verdict"], evidence: string[], extra: Partial<JudgedAssertion> = {}): JudgedAssertion => ({
  kind: "state",
  text: "x",
  verdict,
  evidence,
  searched: verdict === "unsupported" ? ["EXERCISE LOG"] : [],
  missing: verdict === "unsupported" ? "a line saying so" : "",
  outside_knowledge: false,
  ...extra,
});
/** A judgment for a batch: every claim supported by the Hour 60 situation, unless `overrides` says otherwise. */
function judgment(of: Batch, overrides: Record<string, Partial<JudgedClaim>> = {}, noteCheck?: Judgment["note_check"]): Judgment {
  const ref = of.evidence === "story" ? "Hour 60 situation" : "Baseline: Has";
  return {
    note_check: noteCheck ?? batchPrompt(of).noteRefs.map((line) => ({ line, consistent: true, log_references: ["Hour 60 situation"], explanation: "x" })),
    claims: of.cases.map(({ id, claim }) => ({
      id,
      claim,
      basis: of.evidence === "story" ? "story" : "household",
      assertions: [assertion("supported", [ref])],
      verdict: "supported",
      explanation: "x",
      ...overrides[id],
    })),
  };
}

describe("validating a judgment against the contract", () => {
  const storyA = batch("alex story A");
  const claimOf = (j: Judgment, id: string) => validate(storyA, j).claims.find((c) => c.id === id)!;

  it("derives the claim verdict from its assertions", () => {
    expect(derivedVerdict(["supported", "supported"])).toBe("supported");
    expect(derivedVerdict(["supported", "unsupported"])).toBe("unsupported");
    expect(derivedVerdict(["unsupported", "contradicted"])).toBe("contradicted");
    expect(derivedVerdict(["supported", "unclear"])).toBe("unclear");
  });

  it("accepts a valid judgment", () => {
    expect(claimOf(judgment(storyA), "C07")).toMatchObject({ invalid: [], verdict: "supported" });
  });

  it("invalidates a verdict its own assertions don't give (C07 in the first run: supported with a false time)", () => {
    const j = judgment(storyA, {
      C07: { assertions: [assertion("supported", ["Hour 60 outcome"]), assertion("contradicted", ["Hour 72 outcome"], { kind: "time" })], verdict: "supported" },
    });
    expect(claimOf(j, "C07").invalid).toEqual(["verdict supported contradicts its assertions (supported, contradicted)"]);
    expect(claimOf(j, "C07").verdict).toBeUndefined();
  });

  it("invalidates missing and unknown references", () => {
    const j = judgment(storyA, {
      C02: { assertions: [assertion("supported", [])] },
      C04: { assertions: [assertion("supported", ["Hour 61 outcome"])] },
      C11: { assertions: [assertion("unsupported", [], { searched: [], missing: "" })], verdict: "unsupported" },
    });
    expect(claimOf(j, "C02").invalid).toEqual(["assertion 1 (state): supported without evidence references"]);
    expect(claimOf(j, "C04").invalid[0]).toContain("unknown references Hour 61 outcome");
    expect(claimOf(j, "C11").invalid).toEqual(["assertion 1 (state): unsupported without what was searched and what is missing"]);
  });

  it("doesn't accept the note as evidence for a story assertion", () => {
    const j = judgment(storyA, { C02: { assertions: [assertion("supported", ["Note 1"])] } });
    expect(claimOf(j, "C02").invalid).toEqual(["assertion 1 (state): supported without evidence from its basis"]);
  });

  it("counts a contradiction from outside knowledge as unsupported, and reports it (the heater/CO case)", () => {
    const hg = batch("alex household and guidance");
    const j = judgment(hg, {
      C05: {
        basis: "guidance",
        assertions: [assertion("contradicted", ["Guidance 15"], { kind: "cause", outside_knowledge: true })],
        verdict: "contradicted",
      },
    });
    const c05 = validate(hg, j).claims.find((c) => c.id === "C05")!;
    expect(c05).toMatchObject({ invalid: [], verdict: "unsupported", boundaryViolations: ["assertion 1 (cause): contradicted on outside knowledge"] });
    const scored = score(validate(hg, j).claims).find((c) => c.id === "C05")!;
    expect(scored).toMatchObject({ outcome: "detected", verdict: "unsupported", classifiedCorrectly: true });
    expect(scored.boundaryViolations).toHaveLength(1);
  });

  it("counts a story contradiction cited only from the note as unsupported", () => {
    const j = judgment(storyA, { C15: { assertions: [assertion("contradicted", ["Note 2"])], verdict: "contradicted" } });
    expect(claimOf(j, "C15")).toMatchObject({ verdict: "unsupported", boundaryViolations: ["assertion 1 (state): contradicted without evidence from its basis"] });
  });
});

describe("checking the note separately from the claims", () => {
  const storyB = batch("alex story B");
  const corrupted = `Note ${noteLines(storyB).corrupted! + 1}`;
  const refs = batchPrompt(storyB).noteRefs;

  it("requires the corrupted line to be reported, however the claims were judged", () => {
    expect(checkNote(storyB, judgment(storyB))).toEqual({ unchecked: [], corruptionReported: false, falseAlarms: [] });
    const reported = refs.map((line) => ({ line, consistent: line !== corrupted, log_references: ["Hour 60 situation"], explanation: "x" }));
    expect(checkNote(storyB, judgment(storyB, {}, reported))?.corruptionReported).toBe(true);
  });

  it("reports unchecked lines and false alarms", () => {
    const partial = refs.slice(1).map((line) => ({ line, consistent: false, log_references: [], explanation: "x" }));
    const result = checkNote(storyB, judgment(storyB, {}, partial))!;
    expect(result.unchecked).toEqual([refs[0]]);
    expect(result.falseAlarms).toEqual(refs.slice(1).filter((ref) => ref !== corrupted));
  });
});

describe("scoring", () => {
  it("keeps missed defects, false positives, unclear and invalid results apart", () => {
    const storyA = batch("alex story A");
    const inBatch = (scored: ReturnType<typeof score>) => scored.filter((c) => storyA.cases.some((s) => s.id === c.id));
    const allSupported = summarize(inBatch(score(validate(storyA, judgment(storyA)).claims)));
    const defects = storyA.cases.filter((c) => LABELS[c.id].kind === "defect").map((c) => c.id);
    expect(allSupported.missed.map((c) => c.id).sort()).toEqual(defects.sort());
    expect(allSupported.falsePositives).toEqual([]);
    const invalid = summarize(inBatch(score(validate(storyA, judgment(storyA, { C02: { verdict: "contradicted" } })).claims)));
    expect(invalid.invalid.map((c) => c.id)).toEqual(["C02"]);
  });

  it("says whether a mixed claim's false detail was the one flagged", () => {
    const priyaA = batch("priya story A");
    const flagged = judgment(priyaA, {
      C53: { assertions: [assertion("supported", ["Hour 10 outcome"]), assertion("contradicted", ["Hour 10 outcome"], { kind: "time", text: "dizziness eased after two hours" })], verdict: "contradicted" },
      C39: { assertions: [assertion("supported", ["Hour 26 outcome"]), assertion("contradicted", ["Hour 28 outcome"], { kind: "time", text: "it happened when the detector chirped" })], verdict: "contradicted" },
    });
    const scored = score(validate(priyaA, flagged).claims);
    expect(scored.find((c) => c.id === "C53")).toMatchObject({ outcome: "detected", falseDetailFlagged: true });
    // Detected, but on the wrong detail: the neighbor didn't move it.
    expect(scored.find((c) => c.id === "C39")).toMatchObject({ outcome: "detected", falseDetailFlagged: false });
  });
});
