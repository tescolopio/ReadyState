import { describe, expect, it } from "vitest";

import { ALL_CASES, BATCHES, NOTE_CHECKS, PILOT_CALLS, PILOT_PAIRS, pilotBatches, type Batch } from "./cases";
import {
  ASSERTION_KINDS,
  JUDGE_INSTRUCTIONS,
  MAX_OUTPUT_TOKENS,
  NOTE_INSTRUCTIONS,
  NOTE_MAX_OUTPUT_TOKENS,
  batchPrompt,
  checkNote,
  derivedVerdict,
  describeFailedGeneration,
  estimateInputTokens,
  jsonBreak,
  judgmentSchema,
  noteLines,
  notePrompt,
  providerJudgmentSchema,
  referencedLines,
  uncoveredWords,
  untraceableNoteLines,
  validate,
  type CallRun,
  type CallStatus,
  type JudgedAssertion,
  type JudgedClaim,
  type NoteJudgment,
  type ProviderJudgment,
} from "./judge";
import { LABELS } from "./labels";
import { CURRENT_RUN, DIAGNOSTIC_CAP, OUTPUT_LIMIT_RUN, RELAXED_KIND_RUN, TOKENS_PER_MINUTE, chargeFor, diagnosticCalls, stopsTheRun, validateDiagnostic } from "./diagnostic";
import { MAX_CLAIMS_PER_CALL, collectResults, runCalls, splitBatches } from "./run";
import { onFalseDetail, score, summarize } from "./score";

describe("the G11 case set", () => {
  it("labels every case, with unique opaque ids", () => {
    expect(new Set(ALL_CASES.map((c) => c.id)).size).toBe(ALL_CASES.length);
    expect(Object.keys(LABELS).sort()).toEqual(ALL_CASES.map((c) => c.id).sort());
    for (const { id } of ALL_CASES) expect(id).toMatch(/^C\d\d$/);
  });

  it("keeps the Alex cases as development (21, plus 3 pilot rewrites), and reserves new cases from other households", () => {
    expect(ALL_CASES.filter((c) => c.set === "development").map((c) => c.household)).toEqual(Array(24).fill("alex"));
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
function judgment(of: Batch, overrides: Record<string, Partial<JudgedClaim>> = {}): ProviderJudgment {
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
  const resultFor = (j: ProviderJudgment, id: string) => validate(storyB, j).claims.find((c) => c.id === id)!;

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

  it("lets the provider accept any kind, but invalidates an unknown kind locally without normalizing it", () => {
    const withKind = (kind: string) =>
      judgment(storyB, { C09: { assertions: [assertion("supported", claimOf("C09"), [quoteFrom(storyB, "Hour 72 outcome")], { kind })] } });
    const j = withKind("location");
    expect(providerJudgmentSchema.safeParse(j).success).toBe(true);
    const strict = judgmentSchema.safeParse(j);
    expect(strict.success).toBe(false);
    expect(strict.error!.issues.map((issue) => issue.path.join("."))).toEqual([`claims.${storyB.cases.findIndex((c) => c.id === "C09")}.assertions.0.kind`]);
    expect(resultFor(j, "C09")).toMatchObject({ invalid: ["assertion 1 (location): unknown kind"], verdict: undefined });
    // Case variants of a listed kind aren't accepted either.
    expect(resultFor(withKind("State"), "C09").invalid).toEqual(["assertion 1 (State): unknown kind"]);
    for (const kind of ASSERTION_KINDS) {
      expect(judgmentSchema.safeParse(withKind(kind)).success).toBe(true);
      expect(resultFor(withKind(kind), "C09").invalid).toEqual([]);
    }
  });

  it("still applies the evidence and coverage checks alongside an unknown kind", () => {
    const j = judgment(storyB, {
      C09: {
        assertions: [assertion("contradicted", claimOf("C09"), [{ ref: "Hour 60 situation", quote: "power restored at Hour 54" }], { kind: "location" })],
        verdict: "contradicted",
      },
      C25: {
        assertions: [
          assertion("supported", "A 1500-watt space heater", [quoteFrom(storyB, "Hour 72 outcome")], { kind: "equipment" }),
          assertion("supported", "in the apartment repeatedly tripped the breaker", [{ ref: "Hour 61 outcome", quote: "x" }], { kind: "action" }),
        ],
      },
    });
    expect(resultFor(j, "C09").invalid).toEqual([
      "assertion 1 (location): unknown kind",
      'assertion 1 (location): quotation not in Hour 60 situation: "power restored at Hour 54"',
    ]);
    expect(resultFor(j, "C25").invalid).toEqual([
      "claim words no assertion quotes: you, kept",
      "assertion 1 (equipment): unknown kind",
      "assertion 2 (action): unknown reference Hour 61 outcome",
    ]);
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

  it("runs only D1 and D3 in the second diagnostic, within its 10,000-token cap", () => {
    const second = calls.filter((c) => RELAXED_KIND_RUN.calls.includes(c.name));
    expect(second.map((c) => c.name)).toEqual(["D1", "D3"]);
    expect(second.reduce((sum, c) => sum + c.allowance, 0)).toBeLessThanOrEqual(RELAXED_KIND_RUN.cap);
  });

  it("runs D3 alone in the third diagnostic with a 4,000-token output limit, within the 6,500 cap and the per-minute limit", () => {
    expect(CURRENT_RUN).toBe(OUTPUT_LIMIT_RUN);
    const third = diagnosticCalls(OUTPUT_LIMIT_RUN.maxOutputTokens).filter((c) => OUTPUT_LIMIT_RUN.calls.includes(c.name));
    expect(third.map((c) => [c.name, c.maxOutputTokens])).toEqual([["D3", 4000]]);
    // Same input as the earlier D3; only the output limit changes.
    expect(third[0].content).toBe(calls[2].content);
    expect(third[0].allowance).toBe(calls[2].allowance + 1600);
    expect(third[0].allowance).toBeLessThanOrEqual(OUTPUT_LIMIT_RUN.cap);
    expect(third[0].allowance).toBeLessThanOrEqual(TOKENS_PER_MINUTE);
    // The claim calls themselves keep their allowance.
    expect(MAX_OUTPUT_TOKENS).toBe(2400);
  });

  it("charges the full allowance whenever usage isn't reported", () => {
    const run = (status: CallStatus, inputTokens: number, outputTokens: number) => ({ name: "D1", status, usage: { inputTokens, outputTokens }, ms: 0, attempts: 1 });
    expect(chargeFor(run("provider failure", 0, 0), 4000)).toBe(4000);
    expect(chargeFor(run("completed", 0, 0), 4000)).toBe(4000);
    expect(chargeFor(run("completed", 3000, 0), 4000)).toBe(4000);
    expect(chargeFor(run("completed", 3000, 900), 4000)).toBe(3900);
  });

  it("validates a diagnostic judgment against its own lines and claims", () => {
    const d1 = calls[0];
    const quote = { ref: "Hour 6 outcome", quote: referencedLines(d1.content).get("Hour 6 outcome")!.slice(0, 30) };
    const claimsIn = [...d1.content.matchAll(/^(D\d\d): (.*)$/gm)].map((m) => ({ id: m[1], claim: m[2] }));
    const j: ProviderJudgment = {
      claims: claimsIn.map(({ id, claim }) => ({ id, claim, basis: "story", assertions: [assertion("supported", claim, [quote])], verdict: "supported", explanation: "x" })),
    };
    expect(validateDiagnostic(d1.content, j).claims.map((c) => c.invalid)).toEqual([[], []]);
    j.claims[1].assertions[0].kind = "vehicle";
    expect(validateDiagnostic(d1.content, j).claims[1].invalid).toEqual(["assertion 1 (vehicle): unknown kind"]);
  });
});

describe("describing a rejected generation without its content", () => {
  it("reports where JSON breaks, and whether it ends inside a string or open structure", () => {
    expect(jsonBreak('{"claims":[{"id":"D01","claim":"The furn')).toEqual({ layer: "generation", length: 40, position: 40, endsInString: true, unclosed: 3 });
    expect(jsonBreak('{"claims":[{"id":"D01"}]')).toMatchObject({ endsInString: false, unclosed: 1, position: 24 });
    // A break well before the end, with everything closed, doesn't look cut off.
    expect(jsonBreak('{"a":1 "b":2}')).toEqual({ layer: "generation", length: 13, position: 7, endsInString: false, unclosed: 0 });
    // Brackets and escaped quotes inside strings don't count.
    expect(jsonBreak('{"a":"x \\" [ {')).toMatchObject({ endsInString: true, unclosed: 1 });
    expect(jsonBreak('{"a":1}')).toBeUndefined();
  });

  it("checks the arguments inside a {name, arguments} call, and keeps no text", () => {
    const truncated = JSON.stringify({ name: "record", arguments: '{"claims":[{"id":"D01","quote":"secret words' });
    const described = describeFailedGeneration(truncated, judgmentSchema)!;
    expect(described).toEqual({
      length: truncated.length,
      json: false,
      schemaIssues: [],
      parseError: { layer: "arguments", length: 44, position: 44, endsInString: true, unclosed: 3 },
    });
    expect(JSON.stringify(described)).not.toContain("secret");
    expect(describeFailedGeneration('{"claims":[]}', judgmentSchema)).toEqual({ length: 13, json: true, schemaIssues: [] });
  });
});

describe("batching claims at most two a call", () => {
  const parts = splitBatches(BATCHES);
  const parentOf = (part: Batch) => BATCHES.find((b) => part.name === b.name || part.name.startsWith(`${b.name} `))!;

  it("includes every claim exactly once, at most two a call, in the original order", () => {
    const ids = parts.flatMap((part) => part.cases.map((c) => c.id));
    expect(ids).toEqual(BATCHES.flatMap((b) => b.cases.map((c) => c.id)));
    expect(new Set(ids).size).toBe(ALL_CASES.length);
    for (const part of parts) {
      expect(part.cases.length).toBeGreaterThan(0);
      expect(part.cases.length).toBeLessThanOrEqual(MAX_CLAIMS_PER_CALL);
    }
    expect(new Set(parts.map((p) => p.name)).size).toBe(parts.length);
  });

  it("preserves claim ids, wording and every evidence reference of the original batch", () => {
    for (const part of parts) {
      const parent = parentOf(part);
      expect({ ...part, name: parent.name, cases: parent.cases }).toEqual(parent);
      for (const c of part.cases) expect(parent.cases).toContainEqual(c);
      // The same cited lines, word for word: only the claims differ.
      expect(batchPrompt(part).lines).toEqual(batchPrompt(parent).lines);
      for (const { id, claim } of part.cases) expect(batchPrompt(part).text).toContain(`${id}: ${claim}`);
    }
  });

  it("keeps every call under Groq's 8k tokens a minute", () => {
    for (const part of parts) expect(estimateInputTokens(batchPrompt(part).text) + MAX_OUTPUT_TOKENS, part.name).toBeLessThan(TOKENS_PER_MINUTE);
  });

  it("reports a failed call's cases as missing results, keeping the calls that completed", () => {
    const dev = splitBatches(BATCHES.filter((b) => b.set === "development"));
    const runs: CallRun<unknown>[] = dev.map((part, i) =>
      i === 1
        ? { name: part.name, status: "provider failure", error: "status 400, malformed tool call", usage: { inputTokens: 0, outputTokens: 0 }, ms: 0, attempts: 1 }
        : { name: part.name, status: "completed", result: judgment(part), usage: { inputTokens: 1000, outputTokens: 500 }, ms: 0, attempts: 1 },
    );
    const { status, validated } = collectResults(dev, runs);
    expect([...status.keys()].sort()).toEqual(dev.flatMap((p) => p.cases.map((c) => c.id)).sort());
    const failedIds = dev[1].cases.map((c) => c.id);
    expect(validated.map((v) => v.id).sort()).toEqual(dev.flatMap((p, i) => (i === 1 ? [] : p.cases.map((c) => c.id))).sort());
    const scored = score(validated, status);
    for (const id of failedIds) expect(scored.find((c) => c.id === id)!.outcome).toBe("provider failure");
    expect(summarize(scored).coverage.providerFailures).toHaveLength(failedIds.length);
    expect(summarize(scored).coverage.validJudgments.length + summarize(scored).coverage.invalidResponses.length).toBe(scored.length - failedIds.length);
  });

  it("counts the evidence repeated in every call in the allowance", () => {
    const dev = BATCHES.filter((b) => b.set === "development");
    const allowance = (batches: Batch[]) => batches.reduce((sum, b) => sum + estimateInputTokens(batchPrompt(b).text) + MAX_OUTPUT_TOKENS, 0);
    const split = splitBatches(dev);
    for (const parent of dev) {
      const own = split.filter((p) => parentOf(p) === parent);
      // Each part carries its batch's whole evidence, instructions and output limit: n parts cost n − 1 more of each.
      const evidenceOnly = estimateInputTokens(batchPrompt({ ...parent, cases: [] }).text) + MAX_OUTPUT_TOKENS;
      expect(Math.abs(allowance(own) - allowance([parent]) - (own.length - 1) * evidenceOnly)).toBeLessThanOrEqual(own.length);
    }
  });

  it("stays within the budget, charging the full allowance when usage is unknown, and records skipped calls as not run", async () => {
    const results: Record<string, CallRun<unknown>> = {
      a: { name: "a", status: "provider failure", usage: { inputTokens: 0, outputTokens: 0 }, ms: 0, attempts: 1 },
      b: { name: "b", status: "completed", usage: { inputTokens: 0, outputTokens: 0 }, ms: 0, attempts: 1 },
      c: { name: "c", status: "completed", usage: { inputTokens: 900, outputTokens: 300 }, ms: 0, attempts: 1 },
      d: { name: "d", status: "completed", usage: { inputTokens: 900, outputTokens: 300 }, ms: 0, attempts: 1 },
    };
    const started: string[] = [];
    const call = (name: string, allowance: number) => ({ name, allowance, run: async () => (started.push(name), { ...results[name] }) });
    const { runs, charged } = await runCalls([call("a", 4000), call("b", 3000), call("c", 2000), call("d", 2000)], { budget: 10_000 });
    // a and b report no usage, so each is charged in full; c is charged what it reported; d's allowance would pass the budget.
    expect(started).toEqual(["a", "b", "c"]);
    expect(charged).toBe(4000 + 3000 + 1200);
    expect(runs.map((r) => [r.name, r.status])).toEqual([["a", "provider failure"], ["b", "completed"], ["c", "completed"], ["d", "not run"]]);
  });

  it("makes no retries unless asked, and charges each attempt", async () => {
    let calls = 0;
    const failing = { name: "a", allowance: 3000, run: async () => (calls++, { name: "a", status: "provider failure" as const, usage: { inputTokens: 0, outputTokens: 0 }, ms: 0, attempts: 1 }) };
    expect((await runCalls([failing], { budget: 10_000 })).charged).toBe(3000);
    expect(calls).toBe(1);
    expect((await runCalls([failing], { budget: 10_000, attempts: 2 })).charged).toBe(6000);
    expect(calls).toBe(3);
    // A second attempt that would pass the budget isn't made.
    expect((await runCalls([failing], { budget: 5000, attempts: 2 })).runs).toHaveLength(1);
  });
});

describe("the bounded pilot", () => {
  const batches = pilotBatches();

  it("pairs each previously missed defect with an accurate rewrite of it", () => {
    expect(PILOT_PAIRS.map((p) => p.defect)).toEqual(["C07", "C25", "C16", "C19"]);
    for (const { defect, rewrite } of PILOT_PAIRS) {
      expect(LABELS[defect].kind).toBe("defect");
      expect(LABELS[rewrite]).toMatchObject({ kind: "accurate", label: "supported" });
      expect(LABELS[rewrite].source).toContain(`rewrite of ${defect}`);
    }
  });

  it("judges every pilot claim exactly once, two a call, one defect and one other pair's rewrite in each", () => {
    const ids = batches.flatMap((b) => b.cases.map((c) => c.id));
    expect(ids.sort()).toEqual(PILOT_PAIRS.flatMap((p) => [p.defect, p.rewrite]).sort());
    for (const [i, call] of PILOT_CALLS.entries()) {
      expect(call).toHaveLength(2);
      expect(LABELS[call[0]].kind).toBe("defect");
      expect(LABELS[call[1]].kind).toBe("accurate");
      expect(PILOT_PAIRS[i].rewrite).not.toBe(call[1]);
    }
  });

  it("uses only development cases, with the claims and evidence of the development story batches", () => {
    const byId = new Map(ALL_CASES.map((c) => [c.id, c]));
    const storyB = BATCHES.find((b) => b.name === "alex story B")!;
    for (const batch of batches) {
      for (const { id, claim } of batch.cases) expect(byId.get(id)).toMatchObject({ claim, set: "development", household: "alex" });
      expect(batchPrompt(batch).lines).toEqual(batchPrompt(storyB).lines);
    }
  });

  it("fits a preflight budget with every call at its full allowance and under the per-minute limit", () => {
    const allowances = batches.map((b) => estimateInputTokens(batchPrompt(b).text) + MAX_OUTPUT_TOKENS);
    for (const a of allowances) expect(a).toBeLessThan(TOKENS_PER_MINUTE);
    expect(allowances.reduce((sum, a) => sum + a, 0)).toBeLessThanOrEqual(30_000);
  });

  it("counts a defect as detected only when one non-supported assertion quotes its whole false detail", () => {
    const claim = ALL_CASES.find((c) => c.id === "C25")!.claim;
    const result = (quote: string) => ({
      id: "C25",
      invalid: [],
      boundaryViolations: [],
      judged: { id: "C25", claim, basis: "story" as const, verdict: "contradicted" as const, explanation: "x", assertions: [assertion("contradicted", quote, [])] },
    });
    expect(onFalseDetail("C25", result("you kept in the apartment"))).toBe(true);
    expect(onFalseDetail("C25", result("A 1500-watt space heater you"))).toBe(false);
  });
});
