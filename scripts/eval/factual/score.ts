/**
 * Scores validated judgments against the manual labels. Missing results
 * (provider failures, calls not run), invalid responses and valid-but-wrong
 * judgments are kept apart, so neither a failed call nor a broken contract
 * can pass for a wrong judgment, and leaving either out can't inflate
 * accuracy. Detection (was a defect flagged on its false detail) is reported
 * apart from classification (contradicted versus unsupported).
 */
import { ALL_CASES } from "./cases";
import type { CallStatus, ValidatedClaim } from "./judge";
import { LABELS, type Verdict } from "./labels";

export type Outcome =
  | "provider failure"
  | "not run"
  | "invalid response"
  | "detected"
  | "detected on another detail"
  | "missed"
  | "accepted"
  | "false positive"
  | "unclear"
  | "ambiguous";

export interface ScoredCase {
  id: string;
  set: string;
  household: string;
  kind: string;
  type: string;
  expected?: Verdict;
  verdict?: Verdict;
  outcome: Outcome;
  /** For a detected defect: whether contradicted versus unsupported matches the label. */
  classifiedCorrectly?: boolean;
  invalid: string[];
  boundaryViolations: string[];
  explanation?: string;
  /**
   * For a defect: its false detail and every assertion the judge didn't support, with what it cited or found missing.
   * Quoting the whole detail is necessary for "detected" but not sufficient: whether the rejection challenges that
   * detail, rather than another part of the quote, is confirmed by reading these.
   */
  review?: { falseDetail?: string; rejected: { quote: string; verdict: string; evidence: { ref: string; quote: string }[]; missing: string }[] };
}

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/**
 * Whether an assertion the judge didn't support quotes the label's whole false detail. Every word must be in that
 * one assertion's quote (2026-10-31; it was half the words), so "you" alone doesn't count for "you kept".
 */
export function onFalseDetail(id: string, result: ValidatedClaim): boolean {
  const detail = LABELS[id].falseDetail;
  if (!detail) return true;
  const wanted = words(detail);
  return result.judged!.assertions.some((assertion) => {
    if (assertion.verdict === "supported") return false;
    const quoted = new Set(words(assertion.quote));
    return wanted.every((word) => quoted.has(word));
  });
}

/** `status` is each case's call outcome; a case whose call completed is judged on its validated result. */
export function score(validated: ValidatedClaim[], status: Map<string, CallStatus>): ScoredCase[] {
  const byId = new Map(validated.map((claim) => [claim.id, claim]));
  return ALL_CASES.filter(({ id }) => status.has(id)).map(({ id, set, household }) => {
    const label = LABELS[id];
    const call = status.get(id)!;
    const result = byId.get(id);
    const verdict = result?.verdict;
    let outcome: Outcome;
    if (call === "provider failure" || call === "no tool call") outcome = "provider failure";
    else if (call === "not run") outcome = "not run";
    else if (!result || result.invalid.length || !verdict) outcome = "invalid response";
    else if (label.kind === "ambiguous") outcome = "ambiguous";
    else if (verdict === "unclear") outcome = "unclear";
    else if (label.kind === "defect") outcome = verdict === "supported" ? "missed" : onFalseDetail(id, result) ? "detected" : "detected on another detail";
    else outcome = verdict === "supported" ? "accepted" : "false positive";
    return {
      id,
      set,
      household,
      kind: label.kind,
      type: label.type,
      expected: label.label,
      verdict,
      outcome,
      classifiedCorrectly: outcome.startsWith("detected") ? verdict === label.label : undefined,
      invalid: result?.invalid ?? [],
      boundaryViolations: result?.boundaryViolations ?? [],
      explanation: result?.judged?.explanation,
      review:
        label.kind === "defect" && result?.judged
          ? {
              falseDetail: label.falseDetail,
              rejected: result.judged.assertions
                .filter((a) => a.verdict !== "supported")
                .map(({ quote, verdict, evidence, missing }) => ({ quote, verdict, evidence, missing })),
            }
          : undefined,
    };
  });
}

export function summarize(scored: ScoredCase[], set?: string) {
  const cases = set ? scored.filter((c) => c.set === set) : scored;
  const of = (...outcomes: Outcome[]) => cases.filter((c) => outcomes.includes(c.outcome));
  const labeled = cases.filter((c) => c.kind !== "ambiguous");
  const defects = cases.filter((c) => c.kind === "defect");
  const accurate = cases.filter((c) => c.kind === "accurate");
  return {
    cases: cases.length,
    /** Missing results, invalid responses and valid judgments, each over every case. */
    coverage: {
      providerFailures: of("provider failure"),
      notRun: of("not run"),
      invalidResponses: of("invalid response"),
      validJudgments: cases.filter((c) => !["provider failure", "not run", "invalid response"].includes(c.outcome)),
    },
    /** Over every labeled case, so missing and invalid results count as failures. */
    overall: {
      defectsDetectedOnDetail: `${of("detected").filter((c) => c.kind === "defect").length} of ${defects.length}`,
      accurateAccepted: `${of("accepted").length} of ${accurate.length}`,
      labeled: labeled.length,
    },
    detected: of("detected"),
    detectedOnAnotherDetail: of("detected on another detail"),
    misclassified: of("detected", "detected on another detail").filter((c) => !c.classifiedCorrectly),
    missed: of("missed"),
    falsePositives: of("false positive"),
    unclear: of("unclear"),
    ambiguous: of("ambiguous"),
    boundaryViolations: cases.filter((c) => c.boundaryViolations.length),
  };
}
