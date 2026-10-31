/**
 * Checks a debrief before it reaches the participant (work items G1, G9,
 * G11), and the same checks for the eval. Each failure says what to fix, so
 * the server can ask the model for one repair.
 *
 * These are pattern checks with limited coverage. Passing them means the
 * debrief passed the implemented checks, not that it is verified safe or
 * accurate. A cited hour proves the event exists, not that the advice
 * describes it correctly: citation validity and factual support are separate
 * categories, and factual support only covers the known inaccuracies below.
 */
import { SAFETY_RULES } from "@/lib/rules";
import type { AfterActionReport, Improvement, TurnOutput } from "@/lib/ttx";

export type DebriefCheckCategory = "suitability" | "citation" | "safety" | "accuracy";

export interface DebriefProblem {
  category: DebriefCheckCategory;
  /** What's wrong, quoting the debrief. */
  problem: string;
  /** What the repair should do. */
  fix: string;
}

export const MAX_IMPROVEMENTS = 3;

const sentences = (texts: string[]) => texts.flatMap((text) => text.split(/(?<=[.!?])\s+/));
const quote = (text: string, max = 140) => `"${text.length > max ? `${text.slice(0, max)}…` : text}"`;

/**
 * Advice that breaks a safety rule, using each rule's `detect` patterns from
 * data/rules/safety.json. Sentences matching the rule's `exceptWhen` are
 * warnings about the hazard, not advice.
 */
const DETECTORS = SAFETY_RULES.filter((rule) => rule.detect).map((rule) => ({
  id: rule.id,
  prompt: rule.prompt,
  patterns: rule.detect!.map((pattern) => new RegExp(pattern, "i")),
  except: rule.exceptWhen ? new RegExp(rule.exceptWhen, "i") : undefined,
}));

export function unsafeSentences(texts: string[]) {
  return sentences(texts).flatMap((sentence) =>
    DETECTORS.filter(
      (rule) => rule.patterns.some((pattern) => pattern.test(sentence)) && !rule.except?.test(sentence),
    ).map((rule) => ({ rule: rule.id, prompt: rule.prompt, sentence })),
  );
}

/**
 * Bulk supplies. An improvement naming three or more is a kit list, which
 * belongs in `supply_checklist` (eval finding 16).
 */
const SUPPLIES = [
  /\bwater\b/i,
  /\bfood\b/i,
  /\bradio\b/i,
  /\bflashlights?\b|\bheadlamps?\b/i,
  /\b(extra |spare )?batteries\b/i,
  /\bfirst[-‑ ]aid\b/i,
  /\bcan opener\b/i,
  /\bblankets?\b/i,
  /\bsleeping bags?\b/i,
  /\b(dust |N95 )?masks?\b/i,
  /\bplastic sheeting\b/i,
  /\bduct tape\b/i,
  /\bwhistle\b/i,
  /\b(hand )?sanitizer\b/i,
  /\bmoist towelettes\b|\bwipes\b/i,
  /\bgarbage bags\b/i,
  /\bwrench\b|\bpliers\b/i,
  /\bmaps?\b/i,
  /\bcash\b/i,
];
const suppliesIn = (text: string) => SUPPLIES.filter((pattern) => pattern.test(text)).length;
const separators = (text: string) => (text.match(/[,;]/g) ?? []).length;
const listShaped = (text: string) => suppliesIn(text) >= 3 || separators(text) >= 4 || text.length > 260;
const improvementParts = ({ action, evidence, why }: Improvement) => [action, evidence, why];

/** A moment in the exercise ("Hour 18", "Hours 48–66") or a household fact. */
const TRACED = /\bHours? \d+|\b(baseline|household profile|your profile|inventory check|at the start)\b/i;
/** For facts to know, official guidance is also a source; improvements must trace to what happened. */
const GUIDANCE = /\b(guidance|CDC|FEMA|Ready\.gov|Red Cross|USDA|NWS)\b/;

/**
 * Claims known to be wrong, from eval findings. Factual support for anything
 * else is unchecked here (the model judge, G11).
 */
export const KNOWN_INACCURACIES = [
  {
    id: "heater-exceeds-circuit",
    pattern: /\b(1,?500[- ‑]?(w|watts?)\b|space heater)[^.]{0,80}\b(exceeds?|overloads?)\b[^.]{0,60}\bcircuit/i,
    fix: "A 1,500 W heater is within a standard 15-amp, 120 V circuit (1,800 W). It trips a breaker only when other loads share the circuit; say that, or leave it out.",
  },
  {
    id: "detectors-electrical-hazards",
    pattern: /\b(smoke|co|carbon monoxide)\b[^.]{0,60}\b(detectors?|alarms?)\b[^.]{0,80}\belectrical (hazards?|faults?|problems?)\b/i,
    fix: "Smoke alarms detect smoke and CO alarms detect carbon monoxide; neither detects electrical hazards. Describe what each actually detects.",
  },
];

/**
 * Every implemented check, given the turns that happened. An empty list means
 * the debrief passed the implemented checks.
 */
export function checkDebrief(report: AfterActionReport, turns: TurnOutput[]): DebriefProblem[] {
  const problems: DebriefProblem[] = [];
  const add = (category: DebriefCheckCategory, problem: string, fix: string) => problems.push({ category, problem, fix });

  // Suitability: at most three improvements, each one concrete action, bulk supplies in the checklist.
  // The structure doesn't prevent a list: an action or its reason can still be one.
  if (report.do_better.length > MAX_IMPROVEMENTS) {
    add(
      "suitability",
      `do_better has ${report.do_better.length} improvements`,
      `Keep the ${MAX_IMPROVEMENTS} most important and drop the rest; move supply items to supply_checklist.`,
    );
  }
  for (const item of report.do_better) {
    for (const [field, text] of [["action", item.action], ["why", item.why]] as const) {
      if (listShaped(text)) {
        add(
          "suitability",
          `Improvement's ${field} is a list rather than one action: ${quote(text)}`,
          "Rewrite it as one concrete step and put the individual supplies in supply_checklist, one per item, or drop this improvement.",
        );
      }
    }
  }

  // Citation validity: each point says where it comes from, and cited hours happened.
  const hours = new Set(turns.map((turn) => turn.hours_elapsed));
  // Ranges ("Hours 48–66") name a span, so only single hours are checked.
  const checkHours = (texts: string[], shown: string, fix = "") => {
    const cited = texts.flatMap((text) => [...text.matchAll(/\bHour (\d+)\b(?!\s*[-–‑]\s*\d)/gi)].map((match) => Number(match[1])));
    const missing = [...new Set(cited)].filter((hour) => !hours.has(hour));
    if (missing.length) {
      add(
        "citation",
        `Point cites Hour ${missing.join(", Hour ")}, which never happened: ${quote(shown)}`,
        `Cite only hours from the log: ${[...hours].map((hour) => `Hour ${hour}`).join(", ")}${fix}.`,
      );
    }
  };
  for (const point of report.need_to_know) {
    if (!TRACED.test(point) && !GUIDANCE.test(point)) {
      add(
        "citation",
        `Point doesn't say what it comes from: ${quote(point)}`,
        "End it with the hour, decision, household fact or official guidance it comes from, e.g. \"(from Hour 18: …)\".",
      );
    } else checkHours([point], point);
  }
  // Improvements must trace to what happened, not to general guidance.
  for (const item of report.do_better) {
    if (!TRACED.test(item.evidence)) {
      add(
        "citation",
        `Improvement's evidence doesn't name an exercise event or household fact: ${quote(item.evidence || "(empty)")} for ${quote(item.action, 80)}`,
        "Set evidence to the hour, decision or household fact it comes from, e.g. \"Hour 18: the cooler warming\", or drop this improvement if nothing in the exercise supports it.",
      );
    } else checkHours(improvementParts(item), item.action, ", or drop this improvement");
  }

  const improvements = report.do_better.flatMap(improvementParts);
  const all = [report.summary, ...report.need_to_know, ...improvements, ...report.went_well, ...(report.supply_checklist ?? [])];

  // Safety: the detect patterns of data/rules/safety.json.
  for (const { rule, prompt, sentence } of unsafeSentences([...report.need_to_know, ...improvements, ...(report.supply_checklist ?? [])])) {
    add("safety", `Breaks safety rule ${rule}: ${quote(sentence)}`, prompt);
  }

  // Factual support, for known inaccuracies only.
  for (const sentence of sentences(all)) {
    for (const known of KNOWN_INACCURACIES) {
      if (known.pattern.test(sentence)) add("accuracy", `Known inaccuracy (${known.id}): ${quote(sentence)}`, known.fix);
    }
  }

  return problems;
}

/**
 * The repair request: exactly which checks failed and how to fix each. A
 * failing improvement may be dropped instead of fixed, so the repair never has
 * to invent a replacement to fill a slot.
 */
export function repairInstructions(problems: DebriefProblem[]): string {
  return [
    "Your debrief failed these checks. Write the whole debrief again, fixing every one and keeping what passed:",
    ...problems.map((p, i) => `${i + 1}. ${p.problem}\n   Fix: ${p.fix}`),
    "You may drop a failing improvement instead of fixing it. Fewer than three improvements is fine; don't replace a dropped one with a new one.",
  ].join("\n");
}
