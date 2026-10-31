/**
 * What the story established, for the eval's continuity check and the
 * server's debrief checks (work item G9). Heuristics: passing means "passed
 * the implemented checks", not that the story is consistent.
 */
import type { TurnOutput } from "@/lib/ttx";

const sentences = (texts: string[]) => texts.flatMap((text) => text.split(/(?<=[.!?])\s+/));

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
/** The participant's claim to own the item: "my old heater", "we have a radio", "the heater I keep in the closet". */
const possessed = (text: string, item: string) =>
  new RegExp(`\\b(my|our)\\s+(\\S+\\s+){0,3}${item}`, "i").test(text) ||
  new RegExp(`\\b(I|we)\\s+(have|own|keep|kept|stored?|'ve got)\\s+(\\S+\\s+){0,4}${item}`, "i").test(text) ||
  new RegExp(`${item}s?\\s+(that\\s+)?(I|we)\\s+(have|own|keep|kept|stored?)\\b`, "i").test(text);

export const mentions = (text: string, item: string) => new RegExp(`\\b${item}s?\\b`, "i").test(text);
/** "no radio", "without a car", "lacks a working generator": a missing item, not an introduced one. */
export const negated = (text: string, item: string) =>
  new RegExp(`\\b(no|without|lacks?|lacking|doesn't have|don't have)\\s+(an?\\s+|any\\s+)?(\\w+\\s+)?${item}`, "i").test(text);

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
/**
 * A response taken from an offered option. Its wording, including "my" and
 * "find", is the story's, so choosing it doesn't establish anything. Masking
 * can change a word or two, so most of the words matching is enough.
 */
const fromOption = (sentence: string, options: string[]) => {
  const own = words(sentence);
  if (own.length < 4) return false;
  return options.some((option) => {
    const offered = new Set(words(option));
    return own.filter((word) => offered.has(word)).length / own.length >= 0.8;
  });
};

export interface IntroducedItem {
  item: string;
  /** When it first appeared, e.g. "Hour 60". */
  time: string;
  /** Index of that turn. */
  turnIndex: number;
  sentence: string;
  /** True when it first appeared in an offered response option, not in the story's events. */
  fromOption?: boolean;
  /** When the participant later said in their own words that they have or obtained it. */
  establishedLater?: string;
}

/**
 * Equipment the story introduced without the household having or obtaining
 * it (finding 2, eval finding 16). `responses[i]` is the participant's message
 * after `turns[i]`.
 *
 * The participant establishes an item in their own words: by claiming it
 * ("my heater", "the radio we keep", "I find my old heater"), by obtaining it,
 * or by bringing it up before the story did, however they came by it. Choosing
 * an offered option establishes nothing, and neither does acting on an item
 * the story introduced without claiming it ("I find the heater and plug it
 * in"): that adopts the story's invention.
 */
export function introducedEquipment(baseline: string, turns: TurnOutput[], responses: string[]): IntroducedItem[] {
  const established = new Set(EQUIPMENT.filter((item) => mentions(baseline, item)));
  const toldBy = new Set<string>();
  const flagged = new Map<string, IntroducedItem>();
  const offered: string[] = [];

  const establish = (item: string, time: string) => {
    const introduced = flagged.get(item);
    if (introduced) introduced.establishedLater ??= time;
    else established.add(item);
  };

  turns.forEach((turn, turnIndex) => {
    const options = new Set(sentences(turn.response_options));
    for (const sentence of sentences([turn.narrative_response, turn.new_inject, ...turn.response_options])) {
      if (OBTAINED.test(sentence)) continue;
      for (const item of EQUIPMENT) {
        if (!mentions(sentence, item) || negated(sentence, item)) continue;
        toldBy.add(item);
        if (flagged.has(item) || established.has(item)) continue;
        // "space heater" covers "heater".
        if (item === "heater" && flagged.has("space heater")) continue;
        flagged.set(item, { item, time: turn.time_elapsed, turnIndex, sentence, ...(options.has(sentence) ? { fromOption: true } : {}) });
      }
    }
    offered.push(...turn.response_options);

    for (const sentence of sentences([responses[turnIndex] ?? ""])) {
      if (fromOption(sentence, offered)) continue;
      for (const item of EQUIPMENT) {
        if (!mentions(sentence, item) || negated(sentence, item)) continue;
        if (possessed(sentence, item) || OBTAINED.test(sentence) || !toldBy.has(item)) establish(item, turn.time_elapsed);
      }
    }
  });
  return [...flagged.values()];
}

const OUTAGE = /\b(power (outage|is out|went out|goes out|was cut|is cut|cuts? out|fails?|failure)|outages?|blackouts?|without (grid )?power|lost power|loses power|cuts? (the )?power)\b/i;

/**
 * True when the exercise involved a power outage: the chosen emergency, or
 * one the story developed. The debrief's outage restrictions apply even after
 * power returns, because the advice is for the next outage.
 */
export function powerOutageContext(baseline: string, turns: TurnOutput[]): boolean {
  return OUTAGE.test(baseline) || turns.some((turn) => OUTAGE.test(`${turn.narrative_response} ${turn.new_inject}`));
}
