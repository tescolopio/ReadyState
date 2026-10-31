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
/** Finding equipment isn't having it: the model offered "find an electric space heater in the unit" (eval finding 16). */
const FOUND = /\b(find|finds|found|locat\w*|discover\w*|come across)\b/i;

export const mentions = (text: string, item: string) => new RegExp(`\\b${item}s?\\b`, "i").test(text);
/** "no radio", "without a car", "lacks a working generator": a missing item, not an introduced one. */
export const negated = (text: string, item: string) =>
  new RegExp(`\\b(no|without|lacks?|lacking|doesn't have|don't have)\\s+(an?\\s+|any\\s+)?(\\w+\\s+)?${item}`, "i").test(text);

export interface IntroducedItem {
  item: string;
  /** When it first appeared, e.g. "Hour 60". */
  time: string;
  sentence: string;
}

/**
 * Equipment that appears in the story without being in the baseline or
 * obtained (finding 2, eval finding 16). The participant's own words count as
 * establishing an item, except where they only find it.
 */
export function introducedEquipment(baseline: string, turns: TurnOutput[], participantText: string[]): IntroducedItem[] {
  const known = [baseline, ...sentences(participantText).filter((sentence) => !FOUND.test(sentence))].join("\n");
  const flagged = new Map<string, IntroducedItem>();
  for (const turn of turns) {
    const told = sentences([turn.narrative_response, turn.new_inject, ...turn.response_options]);
    for (const sentence of told) {
      if (OBTAINED.test(sentence)) continue;
      for (const item of EQUIPMENT) {
        if (flagged.has(item) || mentions(known, item) || !mentions(sentence, item) || negated(sentence, item)) continue;
        // "space heater" covers "heater".
        if (item === "heater" && flagged.has("space heater")) continue;
        flagged.set(item, { item, time: turn.time_elapsed, sentence });
      }
    }
  }
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
