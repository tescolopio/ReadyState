/**
 * Automatic checks for an eval run, reported in separate categories so that
 * finishing an exercise isn't mistaken for a good one. All are heuristics for
 * review, not guarantees: physically wrong explanations, for example, need the
 * model judge (work item G11). Regression examples live in checks.test.ts.
 */
import { SAFETY_RULES } from "@/lib/rules";
import type { AfterActionReport, TurnOutput } from "@/lib/ttx";

export const CHECK_CATEGORIES = ["privacy", "completion", "structure", "continuity", "safety", "suitability"] as const;
export type CheckCategory = (typeof CHECK_CATEGORIES)[number];

export interface Finding {
  category: CheckCategory;
  text: string;
}

const finding = (category: CheckCategory) => (text: string): Finding => ({ category, text });

const sentences = (texts: string[]) => texts.flatMap((text) => text.split(/(?<=[.!?])\s+/));

/**
 * Advice that breaks a safety rule, using each rule's `detect` patterns from
 * data/rules/safety.json. Sentences matching the rule's `exceptWhen` are
 * warnings about the hazard, not advice.
 */
const DETECTORS = SAFETY_RULES.filter((rule) => rule.detect).map((rule) => ({
  id: rule.id,
  patterns: rule.detect!.map((pattern) => new RegExp(pattern, "i")),
  except: rule.exceptWhen ? new RegExp(rule.exceptWhen, "i") : undefined,
}));

export const unsafeAdvice = (texts: string[]) =>
  sentences(texts).flatMap((sentence) =>
    DETECTORS.filter(
      (rule) => rule.patterns.some((pattern) => pattern.test(sentence)) && !rule.except?.test(sentence),
    ).map((rule) => `${rule.id}: "${sentence}"`),
  );

/** Everything the turns and debrief advise, for the safety check. */
export function adviceTexts(turns: TurnOutput[], report?: AfterActionReport) {
  return [
    ...turns.flatMap((turn) => [
      ...(turn.feedback ? [...turn.feedback.covered, ...turn.feedback.consider, turn.feedback.why] : []),
      ...turn.suggested_actions,
    ]),
    ...(report ? [...report.need_to_know, ...report.do_better, ...(report.supply_checklist ?? [])] : []),
  ];
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

const CITATION = /\(from ([^)]*)\)/i;

/** Debrief points that don't say what they come from, or cite an hour that never happened. */
export function untracedDebriefPoints(report: AfterActionReport, turns: TurnOutput[]): string[] {
  const hours = new Set(turns.map((turn) => turn.hours_elapsed));
  return [...report.need_to_know, ...report.do_better].flatMap((point) => {
    const cited = point.match(CITATION);
    if (!cited) return [`Debrief point doesn't say what it comes from: "${point}"`];
    const hour = cited[1].match(/\bHour (\d+)/i);
    if (hour && !hours.has(Number(hour[1]))) return [`Debrief cites Hour ${hour[1]}, which never happened: "${point}"`];
    return [];
  });
}

/** Grading language the debrief must avoid (decision D8). */
const VERDICT = /\b(grade|score|scored|passed|failed|you (won|lost)|verdict)\b/i;

/** Improvements beyond three, or one that is really a checklist (eval finding 16). */
export function unsuitableDebrief(report: AfterActionReport): string[] {
  const problems: string[] = [];
  if (report.do_better.length > 3) problems.push(`Debrief lists ${report.do_better.length} improvements (at most 3)`);
  for (const item of report.do_better) {
    const commas = (item.match(/,/g) ?? []).length;
    if (commas >= 5 || item.length > 260) problems.push(`Improvement reads like a checklist: "${item.slice(0, 120)}…"`);
  }
  const text = [report.summary, ...report.need_to_know, ...report.do_better, ...report.went_well].join(" ");
  const verdict = text.match(VERDICT);
  if (verdict) problems.push(`Debrief uses grading language: "${verdict[0]}"`);
  return problems;
}

export interface RunForChecks {
  baseline: string;
  turns: TurnOutput[];
  participantText: string[];
  report?: AfterActionReport;
}

/** Continuity, safety, suitability and debrief completion findings for one run. */
export function contentFindings({ baseline, turns, participantText, report }: RunForChecks): Finding[] {
  const out: Finding[] = [];
  out.push(...introducedEquipment(baseline, turns, participantText).map(finding("continuity")));
  out.push(...unsafeAdvice(adviceTexts(turns, report)).map((text) => finding("safety")(`(review) ${text}`)));
  if (report) {
    if (!report.need_to_know.length) out.push(finding("completion")("Debrief has no 'what you need to know'"));
    if (!report.do_better.length) out.push(finding("completion")("Debrief has no 'what you can do better'"));
    out.push(...untracedDebriefPoints(report, turns).map(finding("continuity")));
    out.push(...unsuitableDebrief(report).map(finding("suitability")));
  }
  return out;
}
