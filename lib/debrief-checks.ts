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
import { introducedEquipment, mentions, negated, powerOutageContext } from "@/lib/continuity";
import type { AfterActionReport, Improvement, TurnOutput } from "@/lib/ttx";

export type DebriefCheckCategory = "continuity" | "suitability" | "citation" | "safety" | "accuracy";

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
const ELECTRICAL_FIX =
  "The exercise narrated a breaker trip, which doesn't show why it tripped or what the circuit can carry. Leave out conclusions about circuit capacity, wattage limits or dedicated circuits; if it matters, the household can ask building maintenance or an electrician.";

export const KNOWN_INACCURACIES: { id: string; patterns: RegExp[]; except?: RegExp; fix: string }[] = [
  {
    // A 1,500 W heater is within a 15-amp, 120 V circuit's 1,800 W (eval finding 16).
    id: "heater-exceeds-circuit",
    patterns: [/\b(1,?500[- ‑]?(w|watts?)\b|space heater)[^.]{0,80}\b(exceeds?|overloads?)\b[^.]{0,60}\bcircuit/i],
    fix: ELECTRICAL_FIX,
  },
  {
    id: "detectors-electrical-hazards",
    patterns: [/\b(smoke|co|carbon monoxide)\b[^.]{0,60}\b(detectors?|alarms?)\b[^.]{0,80}\belectrical (hazards?|faults?|problems?)\b/i],
    fix: "Smoke alarms detect smoke and CO alarms detect carbon monoxide; neither detects electrical hazards. Describe what each actually detects.",
  },
  {
    // "No smoke detectors … a required safety device for fire and carbon monoxide detection" (Alex, 2026-10-31).
    id: "smoke-alarm-detects-co",
    patterns: [
      /\bsmoke (detectors?|alarms?)\b[^.]{0,120}\b(carbon monoxide|CO)\b[^.]{0,20}\b(detection|detectors?|detects?|alerts?|warnings?)\b/i,
      /\bsmoke (detectors?|alarms?)\b[^.]{0,80}\b(detects?|detection|alerts?|warns?|senses?)\b[^.]{0,60}\b(carbon monoxide|CO)\b/i,
    ],
    // A combination alarm, or a CO alarm named as its own device, is correct.
    except: /\b(combination|combo|dual[- ‑]sensor)\b|\bsmoke\s*(\/|and|&)\s*(CO|carbon monoxide) (alarms?|detectors?)\b|\b(CO|carbon monoxide) (alarms?|detectors?)\b/i,
    fix: "A smoke alarm detects smoke, not carbon monoxide; that takes a CO alarm or a combination smoke/CO alarm. Name the right device, or leave it out.",
  },
  {
    // A narrated breaker trip shows neither why it tripped nor what the circuit carries (Alex, 2026-10-31).
    id: "unsupported-electrical-conclusion",
    patterns: [
      /\b(circuits?|breakers?|wiring|outlets?|electrical (system|panel))\b[^.]{0,80}\b(cannot|can't|can ?not|unable to|won't|will not)\s+(sustain|handle|support|carry|take|run|power)\b/i,
      /\b(will|would|always)\s+(trip|overload)\w*\b[^.]{0,40}\b(breakers?|circuits?)\b/i,
      /\b(breakers?|circuits?)\b[^.]{0,40}\b(will|would|always)\s+(trip|overload)\w*\b/i,
      /\b(electrical|circuit) capacity\b|\bdedicated circuit\b|\bamp(erage)? rating\b/i,
      /\b80 ?(%|percent)\b[^.]{0,40}\b(circuit|load|breaker|capacity)\b/i,
      // A stated cause: "overloaded the circuit". Recounting the trip ("when the breaker tripped") and
      // advice ("a heat source that does not overload circuits") are fine.
      /\boverload(ed|s)\b[^.]{0,20}\b(circuits?|breakers?)\b/i,
      /\bcaus(ed|es|ing)\b[^.]{0,40}\b(circuits?|breakers?)\b[^.]{0,20}\btrip/i,
    ],
    fix: ELECTRICAL_FIX,
  },
];

/** A whole kit as the action, with no specific first step: "Assemble a basic emergency kit." */
const GENERIC_KIT = /\b(kits?|go[- ‑]bags?|supplies|preparedness items)\b/i;

/** Heat that needs grid power. */
const GRID_HEAT =
  /\b(space heaters?|electric (space )?heaters?|plug[- ‑]in heaters?|ceramic heaters?|oil[- ‑]filled (radiators?|heaters?)|(low|high)[- ‑]wattage (space )?heaters?|\d+[- ‑]?(w|watts?)\b[^.]{0,20}\bheaters?|electric blankets?|heated blankets?|heating pads?)\b/i;
/** A recommendation, in the present or imperative; "You used…" recounts. */
const RECOMMENDS =
  /\b(get|buy|obtain|acquire|purchase|use|keep|have|consider|choose|add|invest in|pick up|rely on|bring|plug in|run|such as|e\.g\.)\b/i;
/** Says grid heat won't help: "Electric heating … is unavailable during a power outage" (Alex, 2026-10-31). */
const UNAVAILABLE = /\b(unavailable|useless|won't (work|run|help)|doesn't (work|run|help)|don't (work|run|help)|can't (work|run)|stops? working)\b/i;
const NOT_ADVICE = /\b(don't|do not|never|avoid|won't|will not|doesn't|does not|can't|cannot|not|instead of|rather than|useless|unavailable)\b/i;
const ACQUIRE = /\b(get|buy|obtain|acquire|purchase|add|borrow|pick up|invest in)\b/i;

const OUTAGE_HEATING = SAFETY_RULES.find((rule) => rule.id === "outage-appropriate-heating");

/** What the participant established, for checks that need more than the turns. */
export interface DebriefContext {
  baseline?: string;
  /** The participant's responses. */
  participantText?: string[];
}

/**
 * Every implemented check, given the turns that happened and, where known,
 * what the household established. An empty list means the debrief passed the
 * implemented checks.
 */
export function checkDebrief(report: AfterActionReport, turns: TurnOutput[], context: DebriefContext = {}): DebriefProblem[] {
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
    if (GENERIC_KIT.test(item.action) && !suppliesIn(item.action) && !listShaped(item.action)) {
      add(
        "suitability",
        `Improvement's action is a whole kit, not a specific first step: ${quote(item.action)}`,
        "Name one specific item or step that fills a gap the exercise showed, e.g. \"Buy a battery radio this week\" (Hour 30: you missed the alert), or drop this improvement.",
      );
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
  const checklist = report.supply_checklist ?? [];
  const all = [report.summary, ...report.need_to_know, ...improvements, ...report.went_well, ...checklist];

  // Continuity: an event in the log isn't a valid premise if the story invented it. Equipment the
  // story introduced without the household having or obtaining it can't ground a point, and the
  // original defect stays attributed to the turn that introduced it.
  if (context.baseline !== undefined) {
    for (const { item, time } of introducedEquipment(context.baseline, turns, context.participantText ?? [])) {
      // A general statement that such equipment won't work isn't a premise about this one.
      const refersTo = (text: string) =>
        (mentions(text, item) || (item === "space heater" && mentions(text, "heater"))) && !negated(text, item) && !UNAVAILABLE.test(text);
      const premises = [
        report.summary,
        ...report.need_to_know,
        ...report.went_well,
        ...report.do_better.flatMap(({ action, evidence, why }) => [evidence, why, ...(ACQUIRE.test(action) ? [] : [action])]),
      ];
      const relying = sentences(premises).filter(refersTo);
      if (relying.length) {
        add(
          "continuity",
          `Relies on the ${item}, which the story introduced at ${time} without the household having or obtaining it: ${relying.slice(0, 3).map((s) => quote(s, 100)).join("; ")}`,
          `Leave the ${item} out: it isn't a valid premise. Base every point on what the household had or obtained, and drop an improvement that depends on it.`,
        );
      }
    }
  }

  // Safety: the detect patterns of data/rules/safety.json.
  const flagged = new Set<string>();
  for (const { rule, prompt, sentence } of unsafeSentences([...report.need_to_know, ...improvements, ...checklist])) {
    flagged.add(`${rule}:${sentence}`);
    add("safety", `Breaks safety rule ${rule}: ${quote(sentence)}`, prompt);
  }
  // In an exercise with a power outage, the outage-heating rule applies to any recommendation of grid-powered
  // heat, whether or not the sentence says "outage", and even after power returned in the story.
  if (OUTAGE_HEATING && powerOutageContext(context.baseline ?? "", turns)) {
    const recommends = (sentence: string) => GRID_HEAT.test(sentence) && RECOMMENDS.test(sentence) && !NOT_ADVICE.test(sentence);
    const recommending = [
      ...sentences([report.summary, ...report.need_to_know, ...report.do_better.flatMap(({ action, why }) => [action, why])]).filter(recommends),
      // A checklist item is a recommendation by being on the list.
      ...checklist.filter((entry) => GRID_HEAT.test(entry) && !NOT_ADVICE.test(entry)),
    ];
    for (const sentence of recommending) {
      if (flagged.has(`${OUTAGE_HEATING.id}:${sentence}`)) continue;
      add("safety", `Recommends grid-powered heat in a power-outage exercise (rule ${OUTAGE_HEATING.id}): ${quote(sentence)}`, OUTAGE_HEATING.prompt);
    }
  }

  // Factual support, for known inaccuracies only.
  for (const sentence of sentences(all)) {
    for (const known of KNOWN_INACCURACIES) {
      if (known.patterns.some((pattern) => pattern.test(sentence)) && !known.except?.test(sentence)) {
        add("accuracy", `Known inaccuracy (${known.id}): ${quote(sentence)}`, known.fix);
      }
    }
  }
  // A breaker trip in the story doesn't justify buying anything.
  for (const item of report.do_better) {
    if (ACQUIRE.test(item.action) && /\b(breakers?|circuits?|tripp?(ed|ing)?)\b/i.test(`${item.evidence} ${item.why}`)) {
      add("accuracy", `Improvement bases a purchase on a breaker trip (unsupported-electrical-conclusion): ${quote(item.action)}`, ELECTRICAL_FIX);
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
