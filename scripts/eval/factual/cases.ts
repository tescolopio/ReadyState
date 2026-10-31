/**
 * The G11 case set for an eval-only factual-consistency judge: claims from
 * Alex's captured debriefs, accurate rewrites, harmless paraphrases and
 * ambiguous ones, grouped into the batches the judge sees. Manual labels are
 * in labels.ts, which the judge code never imports.
 *
 * `split` marks the tuning cases, which the judge prompt was written against,
 * and the reserved ones, written afterwards and not used to adjust it. The ids
 * are opaque so they carry no hint of the label.
 */
export type Split = "tuning" | "reserved";

export interface FactualCase {
  id: string;
  claim: string;
  split: Split;
}

export interface Batch {
  name: string;
  /** Which evidence the judge gets: the story batches get the log, the household-and-guidance batch doesn't. */
  evidence: "story" | "household-and-guidance";
  /** Replaces the story-facts note with one that conflicts with the log, to see whether the judge flags it. */
  corruptStoryFacts?: boolean;
  cases: FactualCase[];
}

export const BATCHES: Batch[] = [
  {
    name: "story A",
    evidence: "story",
    cases: [
      { id: "C07", split: "tuning", claim: "Power was restored at Hour 60, but central heating did not fully recover until about six hours later (between Hour 60 and Hour 72)." },
      { id: "C02", split: "tuning", claim: "You had a friend bring dry clothes, bottled water and a basic emergency kit to the warming center." },
      { id: "C11", split: "tuning", claim: "You coordinated with building staff to restore power." },
      { id: "C04", split: "tuning", claim: "At Hour 66, building management said the central heating would be fully restored in about six hours." },
      { id: "C15", split: "tuning", claim: "Temperatures in the apartment remained near 45 °F for several days." },
      { id: "C09", split: "tuning", claim: "Power was restored at Hour 60, but central heating stayed unavailable and only returned during the Hour 72 turn." },
      { id: "C13", split: "tuning", claim: "Without power, the building's central heating can remain below safe indoor temperatures (45 °F) for many hours." },
    ],
  },
  {
    name: "story B",
    evidence: "story",
    corruptStoryFacts: true,
    cases: [
      { id: "C21", split: "reserved", claim: "Power came back at Hour 60, yet the apartment stayed around 45 °F until the heat returned late in the exercise." },
      { id: "C18", split: "reserved", claim: "The central heating was restored at Hour 66." },
      { id: "C25", split: "reserved", claim: "A 1500-watt space heater you kept in the apartment repeatedly tripped the breaker." },
      { id: "C16", split: "reserved", claim: "Your stored water would have run out well before the 72-hour outage ended." },
      { id: "C23", split: "reserved", claim: "You were never at risk of hypothermia." },
      { id: "C19", split: "reserved", claim: "The breaker trips showed that the apartment's circuit cannot support high-wattage heaters." },
      { id: "C26", split: "reserved", claim: "Building management handled the flood well." },
    ],
  },
  {
    name: "household and guidance",
    evidence: "household-and-guidance",
    cases: [
      { id: "C05", split: "tuning", claim: "A CO alarm matters especially when using electric heaters, which may produce carbon monoxide." },
      { id: "C01", split: "tuning", claim: "You have only 1 gallon of stored water, about one day for one adult." },
      { id: "C08", split: "tuning", claim: "Put battery or battery-backup CO alarms near sleeping areas." },
      { id: "C22", split: "reserved", claim: "You had no flashlights." },
      { id: "C17", split: "reserved", claim: "A closed freezer keeps food frozen for about a week without power." },
      { id: "C24", split: "reserved", claim: "Wet clothing makes hypothermia possible even above 40 °F." },
      { id: "C20", split: "reserved", claim: "Electric space heaters are a poor choice for outages." },
    ],
  },
];

export const ALL_CASES = BATCHES.flatMap((batch) => batch.cases);
