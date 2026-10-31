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
const HEATING = /\b(central heat(ing)?( system)?|heat(ing)? system|heating|furnace|boiler|the heat)\b/i;
/**
 * What a sentence says about heating, read after its heating subject: a forecast isn't an event (finding 37,
 * "will be fully restored in about six hours" became "recovered about six hours later").
 */
const HEATING_STATES: { state: HeatingState; pattern: RegExp }[] = [
  { state: "forecast", pattern: /^[^.]{0,60}\b(will|should|would|is expected to|is scheduled to|is going to)\b[^.]{0,30}\b(be (fully )?restored|come back|return|resume|be back|be working)\b|^[^.]{0,60}\brestored in\b/i },
  { state: "unavailable", pattern: /^[^.]{0,60}\b(slow to recover|still (off|offline|out|down|not)|offline|not (yet )?(working|restored|back)|remains? (off|cold|down)|is (off|out|down))\b/i },
  { state: "restored", pattern: /^[^.]{0,60}\b(comes? back( online| on)?|came back|back online|is restored|was restored|resumes|resumed|turns? back on|is working again)\b/i },
];
export type HeatingState = "unavailable" | "forecast" | "restored";

const split = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean);
const quote = (text: string, max = 110) => `"${text.length > max ? `${text.slice(0, max)}…` : text}"`;

export interface StoryFacts {
  hours: number[];
  /** The first turn whose story says power came back. */
  powerReturned?: { hour: number; sentence: string };
  /** What the story says about heating from then on, in order, each as an observed state, a forecast or a confirmed restoration. */
  heatingAfterPower: { hour: number; state: HeatingState; sentence: string; clause: string }[];
  defects: Pick<IntroducedItem, "item" | "time" | "sentence">[];
}

/** The sentence's heating state, and the sentence from its heating subject on, which is what the note quotes. */
function heatingState(sentence: string): { state: HeatingState; clause: string } | undefined {
  const subject = HEATING.exec(sentence);
  if (!subject) return undefined;
  const after = sentence.slice(subject.index + subject[0].length);
  const state = HEATING_STATES.find(({ pattern }) => pattern.test(after))?.state;
  return state && { state, clause: sentence.slice(subject.index) };
}

export function storyFacts(turns: TurnOutput[], defects: Pick<IntroducedItem, "item" | "time" | "sentence">[] = []): StoryFacts {
  const told = turns.flatMap((turn) =>
    [turn.new_inject, turn.narrative_response].flatMap((text) => split(text ?? "").map((sentence) => ({ hour: turn.hours_elapsed, sentence }))),
  );
  const powerReturned = told.find(({ sentence }) => POWER_BACK.test(sentence));
  const heatingAfterPower = powerReturned
    ? told.flatMap(({ hour, sentence }) => {
        const heating = hour >= powerReturned.hour ? heatingState(sentence) : undefined;
        return heating ? [{ hour, state: heating.state, sentence, clause: heating.clause }] : [];
      })
    : [];
  return { hours: turns.map((turn) => turn.hours_elapsed), powerReturned, heatingAfterPower, defects };
}

const STATE_LABELS: Record<HeatingState, string> = {
  unavailable: "observed: heating unavailable",
  forecast: "forecast only, not an event",
  restored: "confirmed: heating returned during this turn",
};

/** One line on how long heating stayed unavailable, in logged hours only. */
function heatingSummary(powerHour: number, heating: StoryFacts["heatingAfterPower"]) {
  const restored = heating.find(({ state }) => state === "restored");
  if (restored) {
    return `- So heating stayed unavailable from Hour ${powerHour}, when power returned, until it returned during the Hour ${restored.hour} turn. The exact time within that turn is unknown: say "during the Hour ${restored.hour} turn" and give no elapsed time for it.`;
  }
  const lastSeen = heating.filter(({ state }) => state === "unavailable").at(-1);
  return lastSeen ? `- So heating was still unavailable at Hour ${lastSeen.hour}, the last report, after power returned at Hour ${powerHour}.` : "";
}

/** The note as a briefing section. */
export function storyFactsBriefing({ hours, powerReturned, heatingAfterPower, defects }: StoryFacts): string {
  return [
    "STORY FACTS (from the log; don't contradict them or add to them):",
    `- Logged hours: ${hours.map((hour) => `Hour ${hour}`).join(", ")}. Cite only these, and give a duration only between two of them.`,
    ...(powerReturned ? [`- Power returned at Hour ${powerReturned.hour}: ${quote(powerReturned.sentence)}`] : []),
    ...(powerReturned && heatingAfterPower.length
      ? [
          "- Heating after power returned. An observed state or a confirmed restoration is an event; a forecast isn't:",
          ...heatingAfterPower.map(
            ({ hour, state, sentence, clause }) => `  - Hour ${hour}, ${STATE_LABELS[state]}${sentence === powerReturned.sentence ? " (same sentence)" : `: ${quote(clause)}`}`,
          ),
          heatingSummary(powerReturned.hour, heatingAfterPower),
        ].filter(Boolean)
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
