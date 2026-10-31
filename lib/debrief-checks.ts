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
import { introducedEquipment, mentions, negated, powerOutageContext, type IntroducedItem } from "@/lib/continuity";
import type { AfterActionReport, Improvement, TurnOutput } from "@/lib/ttx";

export type DebriefCheckCategory = "continuity" | "suitability" | "citation" | "safety" | "accuracy";

export interface DebriefProblem {
  category: DebriefCheckCategory;
  /** Which check failed, e.g. "vague-kit" or "accuracy:smoke-alarm-detects-co". */
  check: string;
  /** Where, e.g. "do_better[1].action" or "need_to_know[0]". */
  field: string;
  /** The text the check matched. */
  matched: string;
  /** What's wrong, quoting the debrief. */
  problem: string;
  /** What the repair should do. */
  fix: string;
}

export const MAX_IMPROVEMENTS = 3;

/** A piece of the debrief and where it is. */
interface Located {
  field: string;
  text: string;
}

const split = (text: string) => text.split(/(?<=[.!?])\s+/);
const sentences = (texts: string[]) => texts.flatMap(split);
const sentencesOf = (located: Located[]) => located.flatMap(({ field, text }) => split(text).map((sentence) => ({ field, text: sentence })));
const quote = (text: string, max = 140) => `"${text.length > max ? `${text.slice(0, max)}…` : text}"`;

const list = (field: string, texts: string[] = []): Located[] => texts.map((text, i) => ({ field: `${field}[${i}]`, text }));
const improvementFields = (report: AfterActionReport, parts: ("action" | "evidence" | "why")[] = ["action", "evidence", "why"]) =>
  report.do_better.flatMap((item, i) => parts.map((part) => ({ field: `do_better[${i}].${part}`, text: item[part] })));

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

const unsafeMatches = (sentence: string) =>
  DETECTORS.flatMap((rule) => {
    const match = rule.except?.test(sentence) ? null : rule.patterns.map((pattern) => sentence.match(pattern)).find(Boolean);
    return match ? [{ rule: rule.id, prompt: rule.prompt, matched: match[0] }] : [];
  });

export function unsafeSentences(texts: string[]) {
  return sentences(texts).flatMap((sentence) => unsafeMatches(sentence).map(({ rule, prompt }) => ({ rule, prompt, sentence })));
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

/** A moment in the exercise ("Hour 18", "Hours 48–66") or a household fact. */
const TRACED = /\bHours? \d+|\b(baseline|household profile|your profile|inventory check|at the start)\b/i;
/** For facts to know, official guidance is also a source; improvements must trace to what happened. */
const GUIDANCE = /\b(guidance|CDC|FEMA|Ready\.gov|Red Cross|USDA|NWS)\b/;

/**
 * Claims known to be wrong, from eval findings. Factual support for anything
 * else is unchecked here (the model judge, G11).
 */
const ELECTRICAL_FIX =
  "The exercise narrated a breaker trip, which doesn't show why it tripped or what the circuit can carry. Describe what happened if it matters, but leave out its cause and any conclusion about circuit capacity, wattage limits or dedicated circuits; if it matters, the household can ask building maintenance or an electrician.";

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
];

/**
 * Electrical conclusions a narrated breaker trip doesn't support (Alex,
 * 2026-10-31). A sentence is one only when it is about the electrical system
 * and draws a conclusion: a cause for an event, what a circuit can carry, a
 * prediction, or a generalization from what happened. Describing the event
 * ("the breaker tripped and the lights went out") and saying equipment won't
 * work without power are fine.
 */
const ELECTRICAL = /\b(circuits?|breakers?|fuses?|wiring|outlets?|electrical (system|panel|load)|amps?|amperage|(high|power)[- ‑]draw)\b/i;
const CONCLUSIONS: { kind: string; pattern: RegExp }[] = [
  // A cause for the event itself; "you called maintenance because the breaker tripped" gives a reason for an action.
  {
    kind: "cause",
    pattern:
      /\b(caus(e|ed|es|ing)|led to|triggered|result(ed|s|ing)? in)\b[^.]{0,50}\b(trip|blow|overload|short)\w*|\b(tripp(ed|ing)|trips|blew|blown|shorted)\b[^.]{0,20}\b(because|due to|from|as a result of)\b|(?<!\b(avoid|not|don't|never|without|prevent)\s+)\boverload(ed|s|ing)\b|\btoo much (power|load|current|draw)\b/i,
  },
  { kind: "capacity", pattern: /\b(cannot|can't|can ?not|unable to|won't|will not|isn't able to)\s+(sustain|handle|support|carry|take|run|power)\b|\b(electrical|circuit) capacity\b|\bdedicated circuit\b|\bamp(erage)? rating\b|\b80 ?(%|percent)\b|\b(compatible|within) (with )?(the |your )?(apartment's |home's )?(electrical|circuit)/i },
  { kind: "prediction", pattern: /\b(will|would|always)\s+(trip|overload|blow)\w*\b/i },
  {
    kind: "generalization",
    pattern: /\b(showing|shows|showed|proves?|proving|demonstrat\w*|means?|indicat\w*) that\b[^.]{0,80}\b(circuits?|breakers?|wiring|outlets?|heaters?|watt\w*|draw|electrical)\b/i,
  },
];
/** Equipment won't work without power: advice about unavailability, not about capacity. */
const WITHOUT_POWER =
  /\b(unavailable|without (grid |electric )?power|during (a|an|the) (power )?outages?|(in|during) outages|when the power('s| is| goes)? out|while the power is out|power is out|no power)\b/i;

export function electricalConclusion(sentence: string): { kind: string; matched: string } | undefined {
  if (!ELECTRICAL.test(sentence)) return undefined;
  for (const { kind, pattern } of CONCLUSIONS) {
    const match = sentence.match(pattern);
    if (!match) continue;
    if ((kind === "capacity" || kind === "prediction") && WITHOUT_POWER.test(sentence)) continue;
    return { kind, matched: match[0] };
  }
  return undefined;
}

/**
 * A precise interval between events: "took about six hours to restore after
 * power returned" (Alex, 2026-10-31). Hyphenated amounts ("three‑day minimum")
 * and supply durations ("1 day of water") aren't intervals.
 */
const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, eighteen: 18, "twenty-four": 24, "twenty four": 24, "twenty‑four": 24,
};
const AMOUNT = `(?:(?:about|around|roughly|nearly|almost|over|some|just|only|another)\\s+)?(\\d+|${Object.keys(NUMBER_WORDS).join("|")})\\s+(minutes?|hours?|days?)\\b`;
const INTERVALS = [
  new RegExp(`\\b(?:took|takes|taking|within|after|delay of|waited|lasted|spent)\\s+${AMOUNT}`, "gi"),
  new RegExp(`\\b${AMOUNT}\\s+(?:after|later|before|until|to (?:restore|recover|return|come back|resume|arrive|be restored))\\b`, "gi"),
];
const amountInHours = (amount: string, unit: string) => {
  const n = Number(amount) || NUMBER_WORDS[amount.toLowerCase()];
  return /^day/i.test(unit) ? n * 24 : /^minute/i.test(unit) ? n / 60 : n;
};

/**
 * An interval the log's hours don't give. One is supported only when the sentence names two logged hours,
 * outside a parenthetical citation, that are that far apart: a citation like "(Hour 66–72)" says where a
 * point comes from, not when its events happened.
 */
export function unsupportedInterval(sentence: string, hours: Set<number>): string | undefined {
  const anchors = [...sentence.replace(/\([^)]*\)/g, "").matchAll(/\bHours? (\d+)(?:\s*[-–‑]\s*(\d+))?/gi)]
    .flatMap((match) => [match[1], match[2]])
    .filter(Boolean)
    .map(Number)
    .filter((hour) => hours.has(hour));
  const gaps = new Set(anchors.flatMap((a) => anchors.map((b) => Math.abs(a - b))));
  for (const pattern of INTERVALS) {
    for (const match of sentence.matchAll(pattern)) {
      if (!gaps.has(amountInHours(match[1], match[2]))) return match[0];
    }
  }
  return undefined;
}

/** A whole kit as the action, with no specific first step: "Assemble a basic emergency kit." */
const GENERIC_KIT = /\b(kits?|go[- ‑]bags?|supplies|preparedness items)\b/i;

/** Heat that needs grid power. */
const GRID_HEAT =
  /\b(space heaters?|electric (space )?heaters?|plug[- ‑]in heaters?|ceramic heaters?|oil[- ‑]filled (radiators?|heaters?)|(low|high)[- ‑]wattage (space )?(heaters?|heat|heating|heat sources?)|\d+[- ‑]?(w|watts?)\b[^.]{0,20}\bheaters?|electric blankets?|heated blankets?|heating pads?)\b/i;
/** Electrical gear a breaker trip might tempt a purchase of. */
const GRID_GEAR = /\b(surge protectors?|extension cords?|power strips?|circuits?)\b/i;
/** A recommendation, in the present or imperative; "You used…" recounts. */
const RECOMMENDS =
  /\b(get|buy|obtain|acquire|purchase|use|keep|have|consider|choose|add|invest in|pick up|rely on|bring|plug in|run|ensure|ensuring|install|such as|e\.g\.)\b/i;
/** Says grid heat won't help: "Electric heating … is unavailable during a power outage" (Alex, 2026-10-31). */
const UNAVAILABLE = /\b(unavailable|useless|won't (work|run|help)|doesn't (work|run|help)|don't (work|run|help)|can't (work|run)|stops? working)\b/i;
const NOT_ADVICE = /\b(don't|do not|never|avoid|won't|will not|doesn't|does not|can't|cannot|not|instead of|rather than|useless|unavailable)\b/i;
const ACQUIRE = /\b(get|buy|obtain|acquire|purchase|add|borrow|pick up|invest in)\b/i;

const OUTAGE_HEATING = SAFETY_RULES.find((rule) => rule.id === "outage-appropriate-heating");

/** What the participant established, for checks that need more than the turns. */
export interface DebriefContext {
  baseline?: string;
  /** The participant's responses: `participantText[i]` came after `turns[i]`. */
  participantText?: string[];
}

/**
 * Equipment the story introduced that the household never had or obtained:
 * known defects of the exercise, which no debrief point may rely on. Items
 * the participant later established are left out.
 */
export function storyDefects(turns: TurnOutput[], context: DebriefContext): IntroducedItem[] {
  if (context.baseline === undefined) return [];
  return introducedEquipment(context.baseline, turns, context.participantText ?? []).filter((item) => !item.establishedLater);
}

/** The known defects as a briefing section for the debrief call, or "" when there are none. */
export function storyDefectsBriefing(defects: IntroducedItem[]): string {
  if (!defects.length) return "";
  return [
    "KNOWN STORY DEFECTS (equipment the story introduced that the household never had or obtained; don't rely on it, don't recommend using it, and don't draw conclusions from events involving it):",
    ...defects.map(({ item, time, sentence }) => `- The ${item}, first at ${time}: ${quote(sentence, 160)}`),
  ].join("\n");
}

/**
 * Every implemented check, given the turns that happened and, where known,
 * what the household established. An empty list means the debrief passed the
 * implemented checks.
 */
export function checkDebrief(report: AfterActionReport, turns: TurnOutput[], context: DebriefContext = {}): DebriefProblem[] {
  const problems: DebriefProblem[] = [];
  const add = (category: DebriefCheckCategory, check: string, field: string, matched: string, problem: string, fix: string) =>
    problems.push({ category, check, field, matched, problem, fix });

  // Suitability: at most three improvements, each one concrete action, bulk supplies in the checklist.
  // The structure doesn't prevent a list: an action or its reason can still be one.
  if (report.do_better.length > MAX_IMPROVEMENTS) {
    add(
      "suitability",
      "improvement-count",
      "do_better",
      `${report.do_better.length} improvements`,
      `do_better has ${report.do_better.length} improvements`,
      `Keep the ${MAX_IMPROVEMENTS} most important and drop the rest; move supply items to supply_checklist.`,
    );
  }
  for (const { field, text } of improvementFields(report, ["action", "why"])) {
    if (listShaped(text)) {
      add(
        "suitability",
        "list-shaped",
        field,
        text,
        `Improvement's ${field.split(".")[1]} is a list rather than one action: ${quote(text)}`,
        "Rewrite it as one concrete step and put the individual supplies in supply_checklist, one per item, or drop this improvement.",
      );
    }
  }
  report.do_better.forEach((item, i) => {
    const kit = item.action.match(GENERIC_KIT);
    if (kit && !suppliesIn(item.action) && !listShaped(item.action)) {
      add(
        "suitability",
        "vague-kit",
        `do_better[${i}].action`,
        kit[0],
        `Improvement's action is a whole kit, not a specific first step: ${quote(item.action)}`,
        "Name one specific item or step that fills a gap the exercise showed, e.g. \"Buy a battery radio this week\" (Hour 30: you missed the alert), or drop this improvement.",
      );
    }
  });

  // Citation validity: each point says where it comes from, and cited hours happened.
  const hours = new Set(turns.map((turn) => turn.hours_elapsed));
  // Ranges ("Hours 48–66") name a span, so only single hours are checked.
  const checkHours = (located: Located[], shown: string, fix = "") => {
    for (const { field, text } of located) {
      const cited = [...text.matchAll(/\bHour (\d+)\b(?!\s*[-–‑]\s*\d)/gi)].map((match) => Number(match[1]));
      const missing = [...new Set(cited)].filter((hour) => !hours.has(hour));
      if (missing.length) {
        add(
          "citation",
          "hour-not-in-log",
          field,
          missing.map((hour) => `Hour ${hour}`).join(", "),
          `Point cites Hour ${missing.join(", Hour ")}, which never happened: ${quote(shown)}`,
          `Cite only hours from the log: ${[...hours].map((hour) => `Hour ${hour}`).join(", ")}${fix}.`,
        );
      }
    }
  };
  list("need_to_know", report.need_to_know).forEach((point) => {
    if (!TRACED.test(point.text) && !GUIDANCE.test(point.text)) {
      add(
        "citation",
        "uncited",
        point.field,
        point.text,
        `Point doesn't say what it comes from: ${quote(point.text)}`,
        "End it with the hour, decision, household fact or official guidance it comes from, e.g. \"(from Hour 18: …)\".",
      );
    } else checkHours([point], point.text);
  });
  // Improvements must trace to what happened, not to general guidance.
  report.do_better.forEach((item, i) => {
    if (!TRACED.test(item.evidence)) {
      add(
        "citation",
        "uncited",
        `do_better[${i}].evidence`,
        item.evidence,
        `Improvement's evidence doesn't name an exercise event or household fact: ${quote(item.evidence || "(empty)")} for ${quote(item.action, 80)}`,
        "Set evidence to the hour, decision or household fact it comes from, e.g. \"Hour 18: the cooler warming\", or drop this improvement if nothing in the exercise supports it.",
      );
    } else {
      const parts = (["action", "evidence", "why"] as const).map((part) => ({ field: `do_better[${i}].${part}`, text: item[part] }));
      checkHours(parts, item.action, ", or drop this improvement");
    }
  });

  const checklist = list("supply_checklist", report.supply_checklist);
  const all: Located[] = [
    { field: "summary", text: report.summary },
    ...list("need_to_know", report.need_to_know),
    ...improvementFields(report),
    ...list("went_well", report.went_well),
    ...checklist,
  ];

  // Continuity: an event in the log isn't a valid premise if the story invented it. Equipment the
  // story introduced without the household having or obtaining it can't ground a point, and the
  // original defect stays attributed to the turn that introduced it.
  for (const { item, time } of storyDefects(turns, context)) {
    // A general statement that such equipment won't work isn't a premise about this one.
    const refersTo = (text: string) =>
      (mentions(text, item) || (item === "space heater" && mentions(text, "heater"))) && !negated(text, item) && !UNAVAILABLE.test(text);
    const premises: Located[] = [
      { field: "summary", text: report.summary },
      ...list("need_to_know", report.need_to_know),
      ...list("went_well", report.went_well),
      // Recommending to obtain the item doesn't rely on having had it.
      ...report.do_better.flatMap((improvement, i) =>
        (ACQUIRE.test(improvement.action) ? (["evidence", "why"] as const) : (["evidence", "why", "action"] as const)).map((part) => ({
          field: `do_better[${i}].${part}`,
          text: improvement[part],
        })),
      ),
    ];
    for (const sentence of sentencesOf(premises).filter(({ text }) => refersTo(text))) {
      add(
        "continuity",
        "invented-premise",
        sentence.field,
        sentence.text,
        `Relies on the ${item}, which the story introduced at ${time} without the household having or obtaining it: ${quote(sentence.text, 120)}`,
        `Leave the ${item} out: it isn't a valid premise. Base every point on what the household had or obtained, and drop an improvement that depends on it.`,
      );
    }
  }

  // Safety: the detect patterns of data/rules/safety.json.
  const flagged = new Set<string>();
  const advice: Located[] = [...list("need_to_know", report.need_to_know), ...improvementFields(report), ...checklist];
  for (const sentence of sentencesOf(advice)) {
    for (const { rule, prompt, matched } of unsafeMatches(sentence.text)) {
      flagged.add(`${rule}:${sentence.text}`);
      add("safety", `safety:${rule}`, sentence.field, matched, `Breaks safety rule ${rule}: ${quote(sentence.text)}`, prompt);
    }
  }
  // In an exercise with a power outage, the outage-heating rule applies to any recommendation of grid-powered
  // heat, whether or not the sentence says "outage", and even after power returned in the story.
  if (OUTAGE_HEATING && powerOutageContext(context.baseline ?? "", turns)) {
    const recommends = (sentence: string) => GRID_HEAT.test(sentence) && RECOMMENDS.test(sentence) && !NOT_ADVICE.test(sentence);
    const recommending = [
      ...sentencesOf([{ field: "summary", text: report.summary }, ...list("need_to_know", report.need_to_know), ...improvementFields(report, ["action", "why"])]).filter(
        ({ text }) => recommends(text),
      ),
      // A checklist item is a recommendation by being on the list.
      ...checklist.filter(({ text }) => GRID_HEAT.test(text) && !NOT_ADVICE.test(text)),
    ];
    for (const { field, text } of recommending) {
      if (flagged.has(`${OUTAGE_HEATING.id}:${text}`)) continue;
      add(
        "safety",
        "outage-grid-heat",
        field,
        text.match(GRID_HEAT)![0],
        `Recommends grid-powered heat in a power-outage exercise (rule ${OUTAGE_HEATING.id}): ${quote(text)}`,
        OUTAGE_HEATING.prompt,
      );
    }
  }

  // Factual support, for known inaccuracies only.
  for (const { field, text } of sentencesOf(all)) {
    for (const known of KNOWN_INACCURACIES) {
      if (known.except?.test(text)) continue;
      const match = known.patterns.map((pattern) => text.match(pattern)).find(Boolean);
      if (match) add("accuracy", `accuracy:${known.id}`, field, match[0], `Known inaccuracy (${known.id}): ${quote(text)}`, known.fix);
    }
    const interval = field.startsWith("supply_checklist") || GUIDANCE.test(text) ? undefined : unsupportedInterval(text, hours);
    if (interval) {
      add(
        "accuracy",
        "accuracy:unsupported-duration",
        field,
        interval,
        `States a duration the log's hours don't give: ${quote(text)}`,
        `Give a duration only between two logged hours you name, computed from them, e.g. "from Hour 60 to Hour 72, 12 hours". A time the story narrated within a turn isn't a logged hour, so otherwise leave the precise duration out ("several hours", "later"). Logged hours: ${[...hours].map((hour) => `Hour ${hour}`).join(", ")}.`,
      );
    }
    const conclusion = electricalConclusion(text);
    if (conclusion) {
      add(
        "accuracy",
        "accuracy:unsupported-electrical-conclusion",
        field,
        conclusion.matched,
        `Unsupported electrical conclusion (${conclusion.kind}): ${quote(text)}`,
        ELECTRICAL_FIX,
      );
    }
  }
  // A breaker trip in the story doesn't justify buying grid-powered heat or electrical gear.
  report.do_better.forEach((item, i) => {
    const gear = item.action.match(GRID_HEAT) ?? item.action.match(GRID_GEAR);
    if (gear && ACQUIRE.test(item.action) && /\b(breakers?|tripp?(ed|ing)?)\b/i.test(`${item.evidence} ${item.why}`)) {
      add(
        "accuracy",
        "accuracy:purchase-on-trip",
        `do_better[${i}].action`,
        gear[0],
        `Improvement bases a purchase on a breaker trip: ${quote(item.action)}`,
        ELECTRICAL_FIX,
      );
    }
  });

  return problems;
}

const KIT_CHECKS = new Set(["list-shaped", "vague-kit"]);

/**
 * The narrow fallback after a repair (eval finding 28): when the only failures
 * left are one improvement's kit list or whole-kit action, the server drops
 * that improvement whole, with its evidence and reason. It's allowed only if
 * another improvement remains and the result passes every check again. The
 * checklist is left as it is, and the participant is told one was omitted.
 */
export function omitKitImprovement(
  report: AfterActionReport,
  problems: DebriefProblem[],
  turns: TurnOutput[],
  context: DebriefContext = {},
): { report: AfterActionReport; omitted: Improvement; checks: string[] } | undefined {
  if (!problems.length || !problems.every((p) => KIT_CHECKS.has(p.check))) return undefined;
  const improvements = new Set(problems.map((p) => p.field.match(/^do_better\[(\d+)\]/)?.[1]));
  if (improvements.size !== 1 || improvements.has(undefined)) return undefined;
  const index = Number([...improvements][0]);
  const result = { ...report, do_better: report.do_better.filter((_, i) => i !== index) };
  if (!result.do_better.length || checkDebrief(result, turns, context).length) return undefined;
  return { report: result, omitted: report.do_better[index], checks: [...new Set(problems.map((p) => p.check))] };
}

/**
 * The repair request: exactly which checks failed and how to fix each. A
 * failing improvement may be dropped instead of fixed, so the repair never has
 * to invent a replacement to fill a slot.
 */
export function repairInstructions(problems: DebriefProblem[]): string {
  return [
    "Your debrief failed these checks. Write the whole debrief again, fixing every one and keeping what passed:",
    ...problems.map((p, i) => `${i + 1}. ${p.problem} (in ${p.field})\n   Fix: ${p.fix}`),
    "You may drop a failing improvement instead of fixing it. Fewer than three improvements is fine; don't replace a dropped one with a new one. Removing a claim means removing all of it: don't keep its cause or conclusion in other words.",
  ].join("\n");
}
