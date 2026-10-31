/**
 * Scores the judge's verdicts against the manual labels, keeping missed
 * defects and rejected accurate text apart, by type, so overall agreement
 * can't hide either.
 */
import { ALL_CASES } from "./cases";
import type { Judgment } from "./judge";
import { LABELS, type Verdict } from "./labels";

const CAUGHT: Verdict[] = ["contradicted", "unsupported"];

export type Outcome = "caught" | "missed" | "accepted" | "false positive" | "unclear" | "no verdict" | "ambiguous";

export interface ScoredCase {
  id: string;
  split: string;
  kind: string;
  type: string;
  basis: string;
  expected?: Verdict;
  verdict?: Verdict;
  exact: boolean;
  outcome: Outcome;
  basisMatches?: boolean;
  forecastFlagged?: boolean;
  explanation?: string;
  evidence?: string[];
}

export function score(judgments: Judgment[]): ScoredCase[] {
  const verdicts = new Map(judgments.flatMap((judgment) => judgment.verdicts).map((verdict) => [verdict.id, verdict]));
  return ALL_CASES.map(({ id, split }) => {
    const label = LABELS[id];
    const given = verdicts.get(id);
    const verdict = given?.verdict;
    let outcome: Outcome;
    if (label.kind === "ambiguous") outcome = "ambiguous";
    else if (!verdict) outcome = "no verdict";
    else if (verdict === "unclear") outcome = "unclear";
    else if (label.kind === "defect") outcome = CAUGHT.includes(verdict) ? "caught" : "missed";
    else outcome = verdict === "supported" ? "accepted" : "false positive";
    return {
      id,
      split,
      kind: label.kind,
      type: label.type,
      basis: label.basis,
      expected: label.label,
      verdict,
      exact: Boolean(verdict && verdict === label.label),
      outcome,
      basisMatches: given ? given.basis === label.basis : undefined,
      forecastFlagged: label.forecast ? given?.involves_forecast : undefined,
      explanation: given?.explanation,
      evidence: given?.evidence,
    };
  });
}

export function summarize(scored: ScoredCase[]) {
  const count = (outcome: Outcome, split?: string) => scored.filter((c) => c.outcome === outcome && (!split || c.split === split)).length;
  return {
    defects: scored.filter((c) => c.kind === "defect").length,
    caught: count("caught"),
    missed: scored.filter((c) => c.outcome === "missed"),
    accurate: scored.filter((c) => c.kind === "accurate").length,
    accepted: count("accepted"),
    falsePositives: scored.filter((c) => c.outcome === "false positive"),
    unclear: scored.filter((c) => c.outcome === "unclear"),
    noVerdict: scored.filter((c) => c.outcome === "no verdict"),
    ambiguous: scored.filter((c) => c.outcome === "ambiguous"),
    exact: scored.filter((c) => c.exact).length,
    bySplit: Object.fromEntries(
      ["tuning", "reserved"].map((split) => [
        split,
        { caught: count("caught", split), missed: count("missed", split), accepted: count("accepted", split), falsePositives: count("false positive", split), unclear: count("unclear", split) },
      ]),
    ),
  };
}
