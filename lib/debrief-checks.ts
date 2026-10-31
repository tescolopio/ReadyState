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
import { guidanceValue } from "@/lib/rules/engine";
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

/**
 * A moment in the exercise ("Hour 18", "Hours 48–66") or a household fact. The model sometimes writes a
 * no-break space after "Hour" (U+202F, Alex, 11:42 on 2026-10-31), so hour patterns match any space.
 */
const TRACED = /\bHours?\s\d+|\b(baseline|household profile|your profile|at the start)\b/i;
/**
 * The inventory check as a source counts only when one of the findings supplied in the baseline is about the
 * same thing: "You lack a basic emergency kit (inventory gaps)" matches "Missing 10 of 12 basic kit items".
 */
const INVENTORY_CITED = /\binventory( check| gaps?| findings?)?\b/i;
const NOT_A_TOPIC = new Set(
  "the and for with when each person recorded found below minimum cover covers about missing basic item day days stored run short cold outage turn off local extra the inventory check gap gaps your you only".split(" "),
);
const topics = (text: string) =>
  new Set((text.toLowerCase().match(/[a-z]{3,}/g) ?? []).map((word) => word.replace(/(?<=..)s$/, "")).filter((word) => !NOT_A_TOPIC.has(word)));

/** The inventory check's findings as supplied in the baseline ("Gaps found by the inventory check (…): a; b; …"). */
export function inventoryFindings(baseline: string): string[] {
  const listed = baseline.match(/Gaps found by the inventory check[^:\n]*:\s*(.+)/i)?.[1];
  return listed ? listed.split(/;\s*/).map((finding) => finding.replace(/\.$/, "").trim()).filter(Boolean) : [];
}

/** How a citation traces: to the log or the household, to a matching inventory finding, or not at all. */
function citation(text: string, support: string, findings: string[] | undefined): "traced" | "inventory-unmatched" | "uncited" {
  if (TRACED.test(text)) return "traced";
  if (!INVENTORY_CITED.test(text)) return "uncited";
  // Without the baseline (some unit tests) the inventory can't be checked.
  if (!findings) return "traced";
  const about = topics(support);
  return findings.some((finding) => [...topics(finding)].some((topic) => about.has(topic))) ? "traced" : "inventory-unmatched";
}
const INVENTORY_FIX =
  'Cite the inventory finding it comes from, as the baseline words it, e.g. "(inventory check: no smoke detectors recorded)", or the hour or household fact instead.';
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
  // "High‑wattage electric heaters can trip circuit breakers repeatedly in an older building's wiring" (Alex,
  // 11:35 on 2026-10-31). Only a possibility of tripping or overloading counts, not any "can"; "you can" is an action.
  { kind: "generalization", pattern: /(?<!\b(you|we)\s+)\b(can|could|may|might|tends? to|(is|are) likely to|often|frequently|commonly)\s+(repeatedly\s+|easily\s+)?(trip|overload|blow|short)\w*|\bprone to (trip|overload|blow)\w*/i },
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
 * How long a stored supply lasts: "the water supply would have been exhausted after roughly one day" (Alex,
 * 12:04 on 2026-10-31, finding 36). It isn't an interval between events, but it is a claim: it passes only
 * when the baseline's quantity and the applicable rate give it. Water uses the stored gallons, the people
 * line and the sourced rate in data/rules/guidance.json; food uses the stored days directly. Pets change
 * the water rate, so a household with pets can't be checked this way.
 */
const SUPPLY_LASTS = /\b(exhausted|run(s|ning)? out|ran out|last(s|ed|ing)?|cover(s|ed|ing)?|be gone|used up|deplet\w*|enough for)\b/i;
const RESOURCES = [
  // Stored water, not the flood water in the story.
  { name: "water", pattern: /\b(stored water|water supply|drinking water|bottled water|your water|gallons?)\b/gi },
  { name: "food", pattern: /\bfood\b/gi },
] as const;

export type SupplyDuration =
  | { resource: string; claimedDays: number; supportedDays: number; matched: string }
  | { resource: string; claimedDays: number; missing: string; matched: string };

/** A supply-duration claim in the sentence and what the baseline supports, or undefined if there's no such claim. */
export function supplyDuration(sentence: string, baseline: string | undefined): SupplyDuration | undefined {
  if (!SUPPLY_LASTS.test(sentence)) return undefined;
  const amount = new RegExp(AMOUNT, "i").exec(sentence);
  if (!amount || /^minute/i.test(amount[2])) return undefined;
  // The resource the amount is about: the nearest one named before it, else the first after it.
  const named = RESOURCES.flatMap(({ name, pattern }) => [...sentence.matchAll(pattern)].map((match) => ({ name, at: match.index! })));
  const before = named.filter(({ at }) => at < amount.index).sort((a, b) => b.at - a.at)[0];
  const resource = (before ?? named.sort((a, b) => a.at - b.at)[0])?.name;
  if (!resource) return undefined;
  const claimedDays = amountInHours(amount[1], amount[2]) / 24;
  const claim = { resource, claimedDays, matched: amount[0] };

  if (resource === "food") {
    const days = baseline?.match(/\b(\d+(?:\.\d+)?) days? of food\b/i)?.[1];
    return days ? { ...claim, supportedDays: Number(days) } : { ...claim, missing: "the stored days of food" };
  }
  const gallons = baseline?.match(/\b(\d+(?:\.\d+)?) gallons? of stored water\b/i)?.[1];
  const peopleLine = baseline?.match(/^People: (.+)$/m)?.[1];
  const people = peopleLine ? [...peopleLine.matchAll(/\b(\d+)\b/g)].reduce((sum, match) => sum + Number(match[1]), 0) : 0;
  if (!gallons) return { ...claim, missing: "the stored gallons of water" };
  if (!people) return { ...claim, missing: "the number of people" };
  if (/^Pets: /m.test(baseline ?? "")) return { ...claim, missing: "a water rate that includes the pets" };
  return { ...claim, supportedDays: Number(gallons) / (people * guidanceValue("water.supply", "gallonsPerPersonPerDay")) };
}

/** Whether a claimed supply duration matches what the baseline supports, allowing for "about". */
const supplyMatches = (claimed: number, supported: number) => Math.abs(claimed - supported) <= Math.max(0.25, supported * 0.15);

/**
 * An interval the log's hours don't give. One is supported only when the sentence names two logged hours,
 * outside a parenthetical citation, that are that far apart: a citation like "(Hour 66–72)" says where a
 * point comes from, not when its events happened.
 */
export function unsupportedInterval(sentence: string, hours: Set<number>): string | undefined {
  const anchors = [...sentence.replace(/\([^)]*\)/g, "").matchAll(/\bHours?\s(\d+)(?:\s*[-–‑]\s*(\d+))?/gi)]
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
/**
 * Verb forms that recount rather than advise: an auxiliary "have" ("could have led", "you have used") and
 * "had to …" (finding 35, "reliance on a high‑wattage heater exposed vulnerabilities that could have led to…").
 */
const RECOUNTING = /\b(have|has|had)\s+(been|\w+ed|led|had|done|made|gone|kept|run|brought|got|gotten|taken|found|felt|left|spent)\b|\bhad to\s+\w+/gi;
/** Whether a sentence advises by `pattern`, once its recounting verb forms are set aside. */
const advises = (pattern: RegExp, text: string) => pattern.test(text.replace(RECOUNTING, ""));
/** Says grid heat won't help: "Electric heating … is unavailable during a power outage" (Alex, 2026-10-31). */
const UNAVAILABLE = /\b(unavailable|useless|won't (work|run|help)|doesn't (work|run|help)|don't (work|run|help)|can't (work|run)|stops? working)\b/i;
const NOT_ADVICE = /\b(don't|do not|never|avoid|won't|will not|doesn't|does not|can't|cannot|not|instead of|rather than|useless|unavailable)\b/i;
const ACQUIRE = /\b(get|buy|obtain|acquire|purchase|add|borrow|pick up|invest in)\b/i;

/**
 * Heating advice too vague to follow safely: "rely on layered clothing and non‑electrical heat sources" (Alex,
 * 11:35 on 2026-10-31) can be read as fuel-burning heat indoors. It passes when the phrase itself names safe
 * warmth from the approved guidance ("alternative heat sources such as blankets"), and in a warning.
 */
const VAGUE_HEAT =
  /\b(non[- ‑]?electric(al)?|alternative|alternate|other|backup|back[- ‑]up|secondary|supplemental|additional|extra|emergency|off[- ‑]grid|safe|personal|portable|independent)\s+(heat(ing)?|warming|warmth)(\s+(sources?|methods?|options?|devices?|solutions?|strategies|strategy|approaches|plans?|measures))?\b|\b(non[- ‑]?electric(al)?|alternative|backup|safe|portable)\s+heaters?\b|\bsources? of (heat|warmth)\b|\b(other|alternative|alternate|backup|non[- ‑]?electric(al)?)\s+ways?\s+(to|of)\s+(heat|heating|warm|keep warm)\b|\b(heat|heating|warmth)(\s+sources?)?\s+(that|which)\s+((works?|runs?)\s+without|(doesn't|does not|don't|do not|won't)\s+(need|require|use))\s+(grid |electric )?(power|electricity)\b/i;
const VAGUE_HEAT_ADVICE = new RegExp(`${RECOMMENDS.source}|\\b(need|needs|should|plan( for)?|prepare|identify|arrange|stock|store|seek|find|importance of|important|essential|critical|key)\\b`, "i");
/** Safe warmth from rule outage-appropriate-heating, named right after the vague phrase. */
const SAFE_EXAMPLES =
  /^[^.;]{0,30}?\b(such as|like|e\.g\.|including|namely)\s+(?:(?:and|or|a|an|extra|warm|wool|heavy|layered|dry|your)\s+|,\s*)*(layers|layered clothing|warm clothing|clothing|blankets?|sleeping bags?|hand warmers?|a warming center|warming centers?)\b/i;
const FUEL_HEAT = /\b(gas|propane|kerosene|butane|charcoal|grills?|camp(ing)? stoves?|fireplaces?|wood|candles?|generators?|fuel)\b/i;
const HEAT_WARNING = /\b(never|don't|do not|avoid|not|unsafe|dangerous|danger|hazard\w*|risk\w*|carbon monoxide|poison\w*|instead of|rather than)\b|\bCO\b/i;
const clauses = (sentence: string) => sentence.split(/;|:|,\s+(?=but\b|so\b)/);

/** The vague phrase in a sentence of heating advice, or undefined; a checklist item is advice by being on the list. */
export function vagueHeating(sentence: string, listItem = false): string | undefined {
  for (const clause of clauses(sentence)) {
    const match = clause.match(VAGUE_HEAT);
    // The warning has to be outside the phrase: "a heat source that doesn't need power" isn't a warning.
    if (!match || HEAT_WARNING.test(clause.replace(match[0], ""))) continue;
    if (!listItem && !advises(VAGUE_HEAT_ADVICE, clause)) continue;
    const after = clause.slice(match.index! + match[0].length);
    if (SAFE_EXAMPLES.test(after) && !FUEL_HEAT.test(clause)) continue;
    return match[0];
  }
  return undefined;
}

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
      const cited = [...text.matchAll(/\bHour\s(\d+)\b(?!\s*[-–‑]\s*\d)/gi)].map((match) => Number(match[1]));
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
  const findings = context.baseline === undefined ? undefined : inventoryFindings(context.baseline);
  list("need_to_know", report.need_to_know).forEach((point) => {
    const traced = GUIDANCE.test(point.text) ? "traced" : citation(point.text, point.text, findings);
    if (traced === "inventory-unmatched") {
      add(
        "citation",
        "inventory-unmatched",
        point.field,
        point.text.match(INVENTORY_CITED)![0],
        `Point cites the inventory check, but none of its findings is about this: ${quote(point.text)}`,
        INVENTORY_FIX,
      );
    } else if (traced === "uncited") {
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
    const traced = citation(item.evidence, `${item.action} ${item.evidence}`, findings);
    if (traced === "inventory-unmatched") {
      add(
        "citation",
        "inventory-unmatched",
        `do_better[${i}].evidence`,
        item.evidence.match(INVENTORY_CITED)![0],
        `Improvement cites the inventory check, but none of its findings is about it: ${quote(item.evidence)} for ${quote(item.action, 80)}`,
        INVENTORY_FIX,
      );
    } else if (traced === "uncited") {
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
  // Vague heating advice, in every displayed field.
  for (const { field, text } of [...sentencesOf(all.filter(({ field }) => !field.startsWith("supply_checklist"))), ...checklist]) {
    const vague = vagueHeating(text, field.startsWith("supply_checklist"));
    if (vague) {
      add(
        "safety",
        "safety:vague-heating",
        field,
        vague,
        `Heating advice too vague to follow safely; it could be read as fuel-burning heat indoors: ${quote(text)}`,
        'Name the warmth itself, from what works without grid power: layers, blankets, sleeping bags, gathering in one small room, hand warmers or a warming center (e.g. "rely on layered clothing and blankets"). Don\'t refer to heat sources in general.',
      );
    }
  }

  // In an exercise with a power outage, the outage-heating rule applies to any recommendation of grid-powered
  // heat, whether or not the sentence says "outage", and even after power returned in the story.
  if (OUTAGE_HEATING && powerOutageContext(context.baseline ?? "", turns)) {
    const recommends = (sentence: string) => GRID_HEAT.test(sentence) && advises(RECOMMENDS, sentence) && !NOT_ADVICE.test(sentence);
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
    // Without the baseline (some unit tests) a supply duration can't be checked; the server always has it.
    const supply = field.startsWith("supply_checklist") || context.baseline === undefined ? undefined : supplyDuration(text, context.baseline);
    if (supply && ("missing" in supply || !supplyMatches(supply.claimedDays, supply.supportedDays))) {
      add(
        "accuracy",
        "accuracy:unsupported-supply-duration",
        field,
        supply.matched,
        "missing" in supply
          ? `States how long the ${supply.resource} lasts, but the baseline doesn't give ${supply.missing}: ${quote(text)}`
          : `States the ${supply.resource} lasts ${supply.matched}, but the baseline gives about ${+supply.supportedDays.toFixed(1)} days: ${quote(text)}`,
        "missing" in supply
          ? "Leave out how long it lasts, or state only the stored amount the baseline gives."
          : `Use what the baseline gives: about ${+supply.supportedDays.toFixed(1)} days of ${supply.resource}, or leave the duration out.`,
      );
    }
    // A supply duration is checked above; it isn't an interval between events.
    const interval = supply || field.startsWith("supply_checklist") || GUIDANCE.test(text) ? undefined : unsupportedInterval(text, hours);
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
