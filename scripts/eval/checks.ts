/**
 * Automatic checks for an eval run, reported in separate categories so that
 * finishing an exercise isn't mistaken for a good one. All are heuristics:
 * passing means "passed the implemented checks", not verified safe or
 * accurate. Debrief checks are shared with the server (lib/debrief-checks.ts).
 * Regression examples live in checks.test.ts and lib/debrief-checks.test.ts.
 */
import { checkDebrief, unsafeSentences, type DebriefCheckCategory } from "@/lib/debrief-checks";
import type { AfterActionReport, TurnOutput } from "@/lib/ttx";

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

const sentences = (texts: string[]) => texts.flatMap((text) => text.split(/(?<=[.!?])\s+/));

/** Unsafe advice in the given texts, as "rule: sentence". */
export const unsafeAdvice = (texts: string[]) => unsafeSentences(texts).map(({ rule, sentence }) => `${rule}: "${sentence}"`);

/** What the turns advise, for the safety check. */
export function turnAdvice(turns: TurnOutput[]) {
  return turns.flatMap((turn) => [
    ...(turn.feedback ? [...turn.feedback.covered, ...turn.feedback.consider, turn.feedback.why] : []),
    ...turn.suggested_actions,
  ]);
}

/**
 * Equipment the story must not conjure up. A mention counts as introduced
 * when the baseline doesn't list it and the sentence doesn't obtain it from
 * someone or somewhere.
 */
const EQUIPMENT = [
  "space heater",
  "heater",
  "generator",
  "camp stove",
  "grill",
  "chainsaw",
  "sump pump",
  "car",
  "vehicle",
  "truck",
  "radio",
  "power station",
  "solar panel",
];
const OBTAINED =
  /\b(borrow\w*|buy\w*|bought|purchas\w*|neighbou?rs?|friends?|stores?|shops?|offer\w*|lends?|lent|brings?|brought|rent\w*|warming cent(er|re)|shelters?|responders?|crews?|staff)\b/i;
const mentions = (text: string, item: string) => new RegExp(`\\b${item}s?\\b`, "i").test(text);
/** "no radio", "without a car", "lacks a working generator": a missing item, not an introduced one. */
const negated = (text: string, item: string) =>
  new RegExp(`\\b(no|without|lacks?|lacking|doesn't have|don't have)\\s+(an?\\s+|any\\s+)?(\\w+\\s+)?${item}`, "i").test(text);

/** Equipment that appears in the story without being in the baseline or obtained (finding 2, eval finding 16). */
export function introducedEquipment(baseline: string, turns: TurnOutput[], participantText: string[]): string[] {
  const known = [baseline, ...participantText].join("\n");
  const flagged = new Map<string, string>();
  for (const turn of turns) {
    const told = sentences([turn.narrative_response, turn.new_inject, ...turn.response_options]);
    for (const sentence of told) {
      if (OBTAINED.test(sentence)) continue;
      for (const item of EQUIPMENT) {
        if (flagged.has(item) || mentions(known, item) || !mentions(sentence, item) || negated(sentence, item)) continue;
        // "space heater" covers "heater".
        if (item === "heater" && flagged.has("space heater")) continue;
        flagged.set(item, `${turn.time_elapsed}: "${item}" appears without being in the baseline or obtained: "${sentence}"`);
      }
    }
  }
  return [...flagged.values()];
}

const DEBRIEF_CATEGORY: Record<DebriefCheckCategory, CheckCategory> = {
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
    out.push(...checkDebrief(report, turns).map((p) => ({ category: DEBRIEF_CATEGORY[p.category], text: p.problem })));
    const verdict = [report.summary, ...report.need_to_know, ...report.do_better, ...report.went_well].join(" ").match(VERDICT);
    if (verdict) out.push({ category: "suitability", text: `Debrief uses grading language: "${verdict[0]}"` });
  }
  return out;
}

/** Grading language the debrief must avoid (decision D8). */
const VERDICT = /\b(grade|score|scored|passed|failed|you (won|lost)|verdict)\b/i;
