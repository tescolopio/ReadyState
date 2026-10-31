/**
 * A compact note of what the exercise log establishes, for the debrief call:
 * the logged hours, when power returned, whether heating stayed unavailable
 * afterward, equipment the story invented, and a reminder that only the
 * participant's own responses are their actions (eval finding 32, and the
 * invented "coordinated with building staff to restore power" at 11:42 on
 * 2026-10-31).
 *
 * It supports accuracy but doesn't verify it: the model can still contradict
 * the note, and the checks don't compare a debrief against it. Manual review
 * stays the accuracy gate until the model judge (G11).
 */
import type { IntroducedItem } from "@/lib/continuity";
import type { TurnOutput } from "@/lib/ttx";

/** Power coming back as an event, not a hypothetical ("stay with your neighbor until power returns", Hour 42). */
const POWER_BACK =
  /(?<!\b(until|when|once|if|whether|before|after|wait(ing)? for|unless)\s+(the\s+)?)\b(power (is|was|has been|gets) (restored|back)|power (returns|returned|comes back|came back|is back on)|(restores?|restored) (the )?power|electricity (is|was|has been) restored)\b/i;
/** Heating's state, in either direction: "slow to recover", "still offline", "comes back online". */
const HEAT_STATE =
  /\b(central heat(ing)?|heat(ing)? system|heat(ing)?|furnace|boiler)\b[^.]{0,80}\b(slow to recover|still (off|offline|out|down|not)|offline|not (yet )?(working|restored|back)|will be (fully )?restored|restored in|remains? (off|cold|down)|comes? back( online| on)?|came back|back online|is restored|was restored|resumes?|resumed)\b/i;

const split = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean);
const quote = (text: string, max = 120) => `"${text.length > max ? `${text.slice(0, max)}…` : text}"`;

export interface StoryFacts {
  hours: number[];
  /** The first turn whose story says power came back. */
  powerReturned?: { hour: number; sentence: string };
  /** What the story says about heating from then on, in order. */
  heatingAfterPower: { hour: number; sentence: string }[];
  defects: Pick<IntroducedItem, "item" | "time" | "sentence">[];
}

export function storyFacts(turns: TurnOutput[], defects: Pick<IntroducedItem, "item" | "time" | "sentence">[] = []): StoryFacts {
  const told = turns.flatMap((turn) =>
    [turn.new_inject, turn.narrative_response].flatMap((text) => split(text ?? "").map((sentence) => ({ hour: turn.hours_elapsed, sentence }))),
  );
  const powerReturned = told.find(({ sentence }) => POWER_BACK.test(sentence));
  const heatingAfterPower = powerReturned
    ? told.filter(({ hour, sentence }) => hour >= powerReturned.hour && HEAT_STATE.test(sentence))
    : [];
  return { hours: turns.map((turn) => turn.hours_elapsed), powerReturned, heatingAfterPower, defects };
}

/** The note as a briefing section. */
export function storyFactsBriefing({ hours, powerReturned, heatingAfterPower, defects }: StoryFacts): string {
  return [
    "STORY FACTS (from the log; don't contradict them or add to them):",
    `- Logged hours: ${hours.map((hour) => `Hour ${hour}`).join(", ")}. Cite only these, and give a duration only between two of them.`,
    ...(powerReturned ? [`- Power returned at Hour ${powerReturned.hour}: ${quote(powerReturned.sentence)}`] : []),
    ...(heatingAfterPower.length
      ? [
          "- Heating after power returned, in order (if it stayed unavailable, say so; don't describe the cold as only a lack of power):",
          ...heatingAfterPower.map(({ hour, sentence }) => `  - Hour ${hour}: ${quote(sentence)}`),
        ]
      : []),
    ...(defects.length
      ? [
          "- Equipment the story introduced that the household never had or obtained; don't rely on it, recommend it, or draw conclusions from events involving it:",
          ...defects.map(({ item, time, sentence }) => `  - The ${item}, first at ${time}: ${quote(sentence)}`),
        ]
      : []),
    "- The participant's actions are only what their own responses say. Don't credit them with anything else, such as coordinating with building staff or restoring power.",
  ].join("\n");
}
