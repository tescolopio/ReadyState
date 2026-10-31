/**
 * Automatic checks for an eval run, reported in separate categories so that
 * finishing an exercise isn't mistaken for a good one. All are heuristics:
 * passing means "passed the implemented checks", not verified safe or
 * accurate. Debrief checks are shared with the server (lib/debrief-checks.ts).
 * Regression examples live in checks.test.ts and lib/debrief-checks.test.ts.
 */
import { introducedEquipment as introducedItems } from "@/lib/continuity";
import { checkDebrief, unsafeSentences, type DebriefCheckCategory } from "@/lib/debrief-checks";
import { improvementText, type AfterActionReport, type TurnOutput } from "@/lib/ttx";

export const CHECK_CATEGORIES = [
  "privacy",
  "completion",
  "structure",
  "continuity",
  "citation",
  "accuracy",
  "safety",
  "suitability",
] as const;
export type CheckCategory = (typeof CHECK_CATEGORIES)[number];

export interface Finding {
  category: CheckCategory;
  text: string;
  /** From turns replayed out of an earlier run: a known defect, kept in the record but not counted against new output. */
  replayed?: boolean;
}

/** Unsafe advice in the given texts, as "rule: sentence". */
export const unsafeAdvice = (texts: string[]) => unsafeSentences(texts).map(({ rule, sentence }) => `${rule}: "${sentence}"`);

/** What the turns advise, for the safety check. */
export function turnAdvice(turns: TurnOutput[]) {
  return turns.flatMap((turn) => [
    ...(turn.feedback ? [...turn.feedback.covered, ...turn.feedback.consider, turn.feedback.why] : []),
    ...turn.suggested_actions,
  ]);
}

/** Equipment that appears in the story without being in the baseline or obtained (lib/continuity.ts). */
export const introducedEquipment = (baseline: string, turns: TurnOutput[], participantText: string[]) =>
  introducedItems(baseline, turns, participantText).map(
    ({ item, time, sentence }) => `${time}: "${item}" appears without being in the baseline or obtained: "${sentence}"`,
  );

const DEBRIEF_CATEGORY: Record<DebriefCheckCategory, CheckCategory> = {
  continuity: "continuity",
  suitability: "suitability",
  citation: "citation",
  safety: "safety",
  accuracy: "accuracy",
};

export interface RunForChecks {
  baseline: string;
  turns: TurnOutput[];
  participantText: string[];
  report?: AfterActionReport;
  /** Leading turns copied from an earlier run (EVAL_REPLAY). Their findings are marked `replayed`. */
  replayedTurns?: number;
}

/** Continuity, citation, accuracy, safety, suitability and debrief completion findings for one run. */
export function contentFindings({ baseline, turns, participantText, report, replayedTurns = 0 }: RunForChecks): Finding[] {
  const out: Finding[] = [];
  const turnFindings = (slice: TurnOutput[], replayed: boolean) => {
    const mark = (category: CheckCategory) => (text: string): Finding => ({ category, text, ...(replayed ? { replayed } : {}) });
    out.push(...introducedEquipment(baseline, slice, participantText).map(mark("continuity")));
    out.push(...unsafeAdvice(turnAdvice(slice)).map((text) => mark("safety")(`(review) ${text}`)));
  };
  turnFindings(turns.slice(0, replayedTurns), true);
  turnFindings(turns.slice(replayedTurns), false);

  if (report) {
    if (!report.need_to_know.length) out.push({ category: "completion", text: "Debrief has no 'what you need to know'" });
    if (!report.do_better.length) out.push({ category: "completion", text: "Debrief has no 'what you can do better'" });
    // Citations are checked against every hour, replayed or not.
    out.push(...checkDebrief(report, turns, { baseline, participantText }).map((p) => ({ category: DEBRIEF_CATEGORY[p.category], text: p.problem })));
    const verdict = [report.summary, ...report.need_to_know, ...report.do_better.map(improvementText), ...report.went_well].join(" ").match(VERDICT);
    if (verdict) out.push({ category: "suitability", text: `Debrief uses grading language: "${verdict[0]}"` });
  }
  return out;
}

/** Grading language the debrief must avoid (decision D8). */
const VERDICT = /\b(grade|score|scored|passed|failed|you (won|lost)|verdict)\b/i;
