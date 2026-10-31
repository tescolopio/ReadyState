/**
 * Scores validated judgments against the manual labels. Missed defects,
 * rejected accurate text, unclear verdicts and invalid results are kept apart,
 * by type, so overall agreement can't hide any of them. Detection (was a
 * defect flagged at all) is reported apart from classification (contradicted
 * versus unsupported).
 */
import { ALL_CASES } from "./cases";
import type { ValidatedClaim } from "./judge";
import { LABELS, type Verdict } from "./labels";

export type Outcome = "detected" | "missed" | "accepted" | "false positive" | "unclear" | "invalid" | "ambiguous";

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
  /** For a mixed claim the judge didn't support: whether an assertion it didn't support carries the false detail. */
  falseDetailFlagged?: boolean;
  invalid: string[];
  boundaryViolations: string[];
  explanation?: string;
}

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

export function score(validated: ValidatedClaim[]): ScoredCase[] {
  const byId = new Map(validated.map((claim) => [claim.id, claim]));
  return ALL_CASES.map(({ id, set, household }) => {
    const label = LABELS[id];
    const result = byId.get(id);
    const verdict = result?.verdict;
    let outcome: Outcome;
    if (label.kind === "ambiguous") outcome = "ambiguous";
    else if (!result || result.invalid.length || !verdict) outcome = "invalid";
    else if (verdict === "unclear") outcome = "unclear";
    else if (label.kind === "defect") outcome = verdict === "supported" ? "missed" : "detected";
    else outcome = verdict === "supported" ? "accepted" : "false positive";

    let falseDetailFlagged: boolean | undefined;
    if (label.falseDetail && result?.judged && verdict && verdict !== "supported") {
      const detail = words(label.falseDetail);
      falseDetailFlagged = result.judged.assertions.some((assertion) => {
        if (assertion.verdict === "supported") return false;
        const text = new Set(words(assertion.text));
        return detail.filter((word) => text.has(word)).length >= Math.ceil(detail.length / 2);
      });
    }
    return {
      id,
      set,
      household,
      kind: label.kind,
      type: label.type,
      expected: label.label,
      verdict,
      outcome,
      classifiedCorrectly: outcome === "detected" ? verdict === label.label : undefined,
      falseDetailFlagged,
      invalid: result?.invalid ?? ["no result"],
      boundaryViolations: result?.boundaryViolations ?? [],
      explanation: result?.judged?.explanation,
    };
  });
}

export function summarize(scored: ScoredCase[], set?: string) {
  const cases = set ? scored.filter((c) => c.set === set) : scored;
  const of = (outcome: Outcome) => cases.filter((c) => c.outcome === outcome);
  return {
    cases: cases.length,
    defects: cases.filter((c) => c.kind === "defect").length,
    detected: of("detected"),
    misclassified: of("detected").filter((c) => !c.classifiedCorrectly),
    missed: of("missed"),
    accurate: cases.filter((c) => c.kind === "accurate").length,
    accepted: of("accepted"),
    falsePositives: of("false positive"),
    unclear: of("unclear"),
    invalid: of("invalid"),
    ambiguous: of("ambiguous"),
    mixed: cases.filter((c) => c.type.startsWith("mixed")),
    /** Detected with the false detail among the assertions the judge didn't support (every defect names one). */
    detectedOnDetail: of("detected").filter((c) => c.falseDetailFlagged !== false),
    detectedOnOtherDetail: of("detected").filter((c) => c.falseDetailFlagged === false),
    /** Invalid results count as failures in these, so leaving them out can't inflate accuracy. */
    completion: {
      defectsOnDetail: `${of("detected").filter((c) => c.falseDetailFlagged !== false).length} of ${cases.filter((c) => c.kind === "defect").length}`,
      accurateAccepted: `${of("accepted").length} of ${cases.filter((c) => c.kind === "accurate").length}`,
      validResults: `${cases.filter((c) => c.outcome !== "invalid" && c.kind !== "ambiguous").length} of ${cases.filter((c) => c.kind !== "ambiguous").length} labeled`,
    },
    boundaryViolations: cases.filter((c) => c.boundaryViolations.length),
  };
}
