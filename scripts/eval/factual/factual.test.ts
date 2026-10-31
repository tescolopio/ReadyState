import { describe, expect, it } from "vitest";

import { ALL_CASES, BATCHES, NOTE_CHECKS, type Batch } from "./cases";
import {
  JUDGE_INSTRUCTIONS,
  MAX_OUTPUT_TOKENS,
  NOTE_INSTRUCTIONS,
  NOTE_MAX_OUTPUT_TOKENS,
  batchPrompt,
  checkNote,
  derivedVerdict,
  estimateInputTokens,
  noteLines,
  notePrompt,
  uncoveredWords,
  untraceableNoteLines,
  validate,
  type CallStatus,
  type JudgedAssertion,
  type JudgedClaim,
  type Judgment,
  type NoteJudgment,
} from "./judge";
import { LABELS } from "./labels";
import { DIAGNOSTIC_CAP, diagnosticCalls, stopsTheRun } from "./diagnostic";
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
    for (const kind of ["defect", "accurate", "ambiguous"]) expect(reserved.map((c) => LABELS[c.id].kind)).toContain(kind);
  });

  it("names a false detail for every development defect, found in its claim (reserved labels stay as fixed)", () => {
    for (const { id, claim } of ALL_CASES.filter((c) => c.set === "development" && LABELS[c.id].kind === "defect")) {
      expect(claim.toLowerCase(), id).toContain(LABELS[id].falseDetail!.toLowerCase());
    }
  });

  it("includes mixed reserved claims, each naming its one false detail, which appears in the claim", () => {
    const mixed = ALL_CASES.filter((c) => c.set === "reserved" && LABELS[c.id].type.startsWith("mixed"));
    expect(mixed.length).toBeGreaterThanOrEqual(5);
    for (const { id, claim } of mixed) expect(claim.toLowerCase()).toContain(LABELS[id].falseDetail!.toLowerCase());
  });
});

describe("the judge's prompts", () => {
  const claimPrompts = BATCHES.map((batch) => ({ batch, ...batchPrompt(batch) }));
  const notePrompts = NOTE_CHECKS.map((check) => ({ check, ...notePrompt(check) }));

  it("never contain a manual label, a defect type, a source note or a case set", () => {
    for (const text of [JUDGE_INSTRUCTIONS, NOTE_INSTRUCTIONS, ...claimPrompts.map((p) => p.text), ...notePrompts.map((p) => p.text)]) {
      for (const label of Object.values(LABELS)) {
        expect(text).not.toContain(label.source);
        expect(text).not.toContain(label.type);
      }
      expect(text).not.toMatch(/\b(development|reserved|tuning)\b/);
    }
  });

  it("don't give the derived note while judging claims", () => {
    for (const { text } of claimPrompts) {
      expect(text).not.toContain("STORY FACTS");
      expect(text).not.toMatch(/\[Note \d+\]/);
    }
  });

  it("give story claims the log, and household-and-guidance claims the baseline and guidance", () => {
    for (const { batch, text } of claimPrompts) {
      if (batch.evidence === "story") {
        expect(text).toMatch(/\[Response after Hour \d+\]/);
        expect(text).not.toContain("APPROVED GUIDANCE");
        for (const hour of batch.omitHours ?? []) expect(text, `${batch.name} Hour ${hour}`).not.toContain(`[Hour ${hour} outcome]`);
      } else {
        expect(text).not.toContain("EXERCISE LOG");
        expect(text).toContain("[Guidance 1]");
        expect(text).toContain("[Baseline: Has]");
      }
    }
  });

  it("leave offered choices out of the claims' log", () => {
    const charlotte = claimPrompts.find((p) => p.batch.name === "charlotte story B")!.text;
    expect(charlotte).toContain("[Hour 66 situation]");
    expect(charlotte).not.toContain("They suggest three options");
    expect(charlotte).not.toContain("offered option");
  });

  it("check the note against the hours it names, with offered options labeled apart from events", () => {
    const alex = notePrompts.find((p) => p.check.household === "alex")!;
    expect(alex.text).toContain("[Hour 60 offered option");
    expect(alex.text).toContain("not events");
    expect(alex.text).not.toContain("[Response after");
    expect(alex.lines.get(alex.corruptedRef)).toContain("Power returned at Hour 54");
  });

  it("trace every note line but the planted one to evidence in its call", () => {
    for (const check of NOTE_CHECKS) expect(untraceableNoteLines(check), check.name).toEqual([]);
  });

  it("leave the note's headers, instructions and logged hours out of the note check", () => {
    for (const check of NOTE_CHECKS) {
      for (const line of noteLines(check).lines) expect(line).not.toMatch(/:$|^Logged hours:|^The participant's actions/);
    }
  });

  it("label an item that first appeared in an offered option as offered, not done", () => {
    const { lines } = noteLines(NOTE_CHECKS.find((c) => c.household === "alex")!);
    expect(lines.some((line) => line.startsWith("The space heater, first offered as a choice at Hour 60 (not a completed action)"))).toBe(true);
  });

  it("keep every call under Groq's 8k tokens a minute, with the answer's allowance", () => {
    for (const { batch, text } of claimPrompts) expect(estimateInputTokens(text) + MAX_OUTPUT_TOKENS, batch.name).toBeLessThan(8000);
    for (const { check, text } of notePrompts) expect(estimateInputTokens(text, NOTE_INSTRUCTIONS) + NOTE_MAX_OUTPUT_TOKENS, check.name).toBeLessThan(8000);
  });
});

const batch = (name: string) => BATCHES.find((b) => b.name === name)!;
const assertion = (verdict: JudgedAssertion["verdict"], quote: string, evidence: JudgedAssertion["evidence"], extra: Partial<JudgedAssertion> = {}): JudgedAssertion => ({
  kind: "state",
  quote,
  verdict,
  evidence,
  searched: verdict === "unsupported" ? ["EXERCISE LOG"] : [],
  missing: verdict === "unsupported" ? "a line saying so" : "",
  outside_knowledge: false,
  ...extra,
});
/** A real quotation from a line of the batch's prompt. */
const quoteFrom = (of: Batch, ref: string) => ({ ref, quote: batchPrompt(of).lines.get(ref)!.slice(0, 40) });
/** A valid judgment: every claim one assertion quoting all of it, supported by a real quotation. */
function judgment(of: Batch, overrides: Record<string, Partial<JudgedClaim>> = {}): Judgment {
  const ref = of.evidence === "story" ? [...batchPrompt(of).lines.keys()].find((key) => key.endsWith(" outcome"))! : "Baseline: Has";
  return {
    claims: of.cases.map(({ id, claim }) => ({
      id,
      claim,
      basis: of.evidence === "story" ? "story" : "household",
      assertions: [assertion("supported", claim, [quoteFrom(of, ref)])],
      verdict: "supported",
      explanation: "x",
      ...overrides[id],
    })),
  };
}

describe("validating a claim judgment", () => {
  const storyB = batch("alex story B");
  const claimOf = (id: string) => storyB.cases.find((c) => c.id === id)!.claim;
  const resultFor = (j: Judgment, id: string) => validate(storyB, j).claims.find((c) => c.id === id)!;

  it("derives the claim verdict from its assertions", () => {
    expect(derivedVerdict(["supported", "unsupported"])).toBe("unsupported");
    expect(derivedVerdict(["unsupported", "contradicted"])).toBe("contradicted");
  });

  it("accepts a valid judgment", () => {
    expect(resultFor(judgment(storyB), "C09")).toMatchObject({ invalid: [], verdict: "supported" });
  });

  it('invalidates a decomposition that drops a detail (C25 in the development run dropped "you kept")', () => {
    expect(uncoveredWords(claimOf("C25"), ["A 1500-watt space heater", "in the apartment repeatedly tripped the breaker"])).toEqual(["you", "kept"]);
    const j = judgment(storyB, {
      C25: {
        assertions: [
          assertion("supported", "A 1500-watt space heater", [quoteFrom(storyB, "Hour 72 outcome")], { kind: "provenance" }),
          assertion("supported", "in the apartment repeatedly tripped the breaker", [quoteFrom(storyB, "Hour 72 outcome")], { kind: "action" }),
        ],
      },
    });
    expect(resultFor(j, "C25").invalid).toEqual(["claim words no assertion quotes: you, kept"]);
  });

  it("invalidates an assertion quote that isn't a span of the claim", () => {
    const j = judgment(storyB, { C18: { assertions: [assertion("contradicted", "heating restored at Hour 66", [quoteFrom(storyB, "Hour 66 situation")])], verdict: "contradicted" } });
    expect(resultFor(j, "C18").invalid[0]).toContain("its quote isn't a span of the claim");
  });

  it("invalidates an invented quotation (C09 in the development run cited the Hour 60 situation for power at Hour 54)", () => {
    const j = judgment(storyB, {
      C09: { assertions: [assertion("contradicted", claimOf("C09"), [{ ref: "Hour 60 situation", quote: "power restored at Hour 54" }])], verdict: "contradicted" },
    });
    expect(resultFor(j, "C09").invalid).toEqual(['assertion 1 (state): quotation not in Hour 60 situation: "power restored at Hour 54"']);
  });

  it("accepts quotations with typographic differences only", () => {
    const line = batchPrompt(storyB).lines.get("Hour 72 outcome")!;
    const typographic = line.slice(0, 60).replace(/‑/g, "-").replace(/’/g, "'");
    const j = judgment(storyB, { C09: { assertions: [assertion("supported", claimOf("C09"), [{ ref: "[Hour 72 outcome]", quote: typographic }])] } });
    expect(resultFor(j, "C09").invalid).toEqual([]);
  });

  it("invalidates unknown references, missing evidence and a verdict its assertions don't give", () => {
    const j = judgment(storyB, {
      C09: { assertions: [assertion("supported", claimOf("C09"), [{ ref: "Hour 61 outcome", quote: "x" }])] },
      C21: { assertions: [assertion("supported", claimOf("C21"), [])] },
      C18: { assertions: [assertion("contradicted", claimOf("C18"), [quoteFrom(storyB, "Hour 66 situation")])], verdict: "supported" },
      C13: { assertions: [assertion("unsupported", claimOf("C13"), [], { searched: [], missing: "" })], verdict: "unsupported" },
    });
    expect(resultFor(j, "C09").invalid).toEqual(["assertion 1 (state): unknown reference Hour 61 outcome"]);
    expect(resultFor(j, "C21").invalid).toEqual(["assertion 1 (state): supported without evidence"]);
    expect(resultFor(j, "C18").invalid).toEqual(["verdict supported contradicts its assertions (contradicted)"]);
    expect(resultFor(j, "C13").invalid).toEqual(["assertion 1 (state): unsupported without what was searched and what is missing"]);
  });

  it("counts a contradiction from outside knowledge as unsupported, and reports it (the heater/CO case)", () => {
    const hg = batch("alex household and guidance");
    const c05 = hg.cases.find((c) => c.id === "C05")!.claim;
    const j = judgment(hg, {
      C05: { basis: "guidance", assertions: [assertion("contradicted", c05, [quoteFrom(hg, "Guidance 15")], { kind: "cause", outside_knowledge: true })], verdict: "contradicted" },
    });
    const result = validate(hg, j).claims.find((c) => c.id === "C05")!;
    expect(result).toMatchObject({ invalid: [], verdict: "unsupported", boundaryViolations: ["assertion 1 (cause): contradicted on outside knowledge"] });
  });
});

describe("checking the note", () => {
  const check = NOTE_CHECKS.find((c) => c.household === "alex")!;
  const { noteRefs, corruptedRef, lines } = notePrompt(check);
  const entries = (planted: Partial<NoteJudgment["lines"][number]>): NoteJudgment => ({
    lines: noteRefs.map((line) => ({
      line,
      verdict: "consistent",
      conflicting_detail: "",
      evidence: [{ ref: "Hour 60 situation", quote: lines.get("Hour 60 situation")!.slice(0, 30) }],
      explanation: "x",
      ...(line === corruptedRef ? planted : {}),
    })),
  });

  it("doesn't count the development run's inverted report as detecting the planted line", () => {
    // Marked inconsistent, but on the planted value and citing a line that says nothing about power.
    const result = checkNote(check, entries({ verdict: "inconsistent", conflicting_detail: "not Hour 60", evidence: [{ ref: "Hour 54 outcome", quote: "power restored at Hour 54" }] }));
    expect(result.planted).toEqual({ detected: false, markedInconsistent: true, onDetail: false, refutedCorrectly: false });
    expect(result.invalid).toEqual([`${corruptedRef}: quotation not in Hour 54 outcome: "power restored at Hour 54"`]);
  });

  it("counts the planted line detected only on its detail, with a correct quotation from a refuting line", () => {
    const refute = { ref: "Hour 60 situation", quote: "Power is restored but the building’s central heating is slow to recover" };
    expect(checkNote(check, entries({ verdict: "inconsistent", conflicting_detail: "Hour 54", evidence: [refute] })).planted.detected).toBe(true);
    expect(checkNote(check, entries({ verdict: "inconsistent", conflicting_detail: "the heating", evidence: [refute] })).planted.detected).toBe(false);
    expect(checkNote(check, entries({ verdict: "consistent", evidence: [refute] })).planted.detected).toBe(false);
  });

  it("reports unchecked lines and false alarms", () => {
    const partial = entries({});
    partial.lines = partial.lines.slice(1).map((entry) => ({ ...entry, verdict: "inconsistent" as const }));
    const result = checkNote(check, partial);
    expect(result.unchecked).toEqual([noteRefs[0]]);
    expect(result.falseAlarms).toEqual(noteRefs.slice(1).filter((ref) => ref !== corruptedRef));
  });
});

describe("scoring", () => {
  const storyA = batch("alex story A");
  const statusFor = (status: CallStatus) => new Map(storyA.cases.map((c) => [c.id, status]));

  it("keeps provider failures, calls not run, invalid responses and valid judgments apart", () => {
    expect(summarize(score([], statusFor("provider failure"))).coverage.providerFailures).toHaveLength(storyA.cases.length);
    expect(summarize(score([], statusFor("not run"))).coverage.notRun).toHaveLength(storyA.cases.length);
    const invalid = validate(storyA, judgment(storyA, { C02: { verdict: "contradicted" } })).claims;
    const summary = summarize(score(invalid, statusFor("completed")));
    expect(summary.coverage.invalidResponses.map((c) => c.id)).toEqual(["C02"]);
    expect(summary.coverage.validJudgments).toHaveLength(storyA.cases.length - 1);
  });

  it("counts missing and invalid results as failures overall", () => {
    const defects = storyA.cases.filter((c) => LABELS[c.id].kind === "defect").length;
    expect(summarize(score([], statusFor("provider failure"))).overall.defectsDetectedOnDetail).toBe(`0 of ${defects}`);
  });

  it("tells a defect detected on its false detail from one detected on another", () => {
    const priyaA = batch("priya story A");
    const ref = { ref: "Hour 10 outcome", quote: batchPrompt(priyaA).lines.get("Hour 10 outcome")!.slice(0, 30) };
    const j = judgment(priyaA, {
      C53: {
        assertions: [
          assertion("supported", "You drove Person 3, the bird and the medication to a cooling center", [ref]),
          assertion("contradicted", "where Person 3's dizziness eased after about two hours", [ref]),
        ],
        verdict: "contradicted",
      },
      C39: {
        assertions: [
          assertion("contradicted", "When the carbon monoxide detector chirped", [ref]),
          assertion("supported", "the neighbor moved the generator to the open side of the driveway", [ref]),
        ],
        verdict: "contradicted",
      },
    });
    const scored = score(validate(priyaA, j).claims, new Map(priyaA.cases.map((c) => [c.id, "completed" as CallStatus])));
    expect(scored.find((c) => c.id === "C53")!.outcome).toBe("detected");
    expect(scored.find((c) => c.id === "C39")!.outcome).toBe("detected on another detail");
  });
});

describe("the provider diagnostic", () => {
  const calls = diagnosticCalls();

  it("uses synthetic content only, sharing nothing with the case set", () => {
    for (const { content } of calls) {
      expect(content).not.toMatch(/\b(Alex|Charlotte|Priya|Person 2|Person 3|CPAP|space heater)\b/);
      for (const { claim } of ALL_CASES) expect(content).not.toContain(claim);
    }
  });

  it("varies one factor per call, and fits the 16,000-token cap with each call under the per-minute limit", () => {
    const [d1, d2, d3] = calls;
    expect(d2.content.length).toBeGreaterThan(d1.content.length * 4);
    expect((d3.content.match(/^D\d\d:/gm) ?? []).length).toBe(5);
    expect((d1.content.match(/^D\d\d:/gm) ?? []).length).toBe(2);
    expect(calls.reduce((sum, c) => sum + c.allowance, 0)).toBeLessThanOrEqual(DIAGNOSTIC_CAP);
    for (const c of calls) expect(c.allowance).toBeLessThan(8000);
  });

  it("stops early only for failures that would break the remaining calls", () => {
    const failure = (error: string, errorCode?: string) => ({ name: "D1", status: "provider failure" as const, error, errorCode, usage: { inputTokens: 0, outputTokens: 0 }, ms: 0, attempts: 1 });
    expect(stopsTheRun(failure("status 400, malformed tool call", "tool_use_failed"), true)).toBeUndefined();
    expect(stopsTheRun(failure("status 401, other"), true)).toContain("key or model");
    expect(stopsTheRun(failure("status 429, rate limit"), false)).toContain("rate-limited");
    expect(stopsTheRun(failure("status 413, request too large"), true)).toContain("smallest call");
    expect(stopsTheRun(failure("status 413, request too large"), false)).toBeUndefined();
    expect(stopsTheRun(failure("status 400, other", "invalid_request_error"), true)).toContain("parameter was refused");
  });
});
