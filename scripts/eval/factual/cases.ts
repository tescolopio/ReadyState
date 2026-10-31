/**
 * The G11 case set for an eval-only factual-consistency judge, grouped into
 * the batches the judge sees. Manual labels are in labels.ts, which the judge
 * code never imports.
 *
 * - development: the 21 Alex cases from the first run (2026-10-31). Their
 *   results have been seen, so they show the effect of a method change but
 *   can't validate it.
 * - reserved: new cases from other households (Charlotte, hurricane; Priya,
 *   heat wave), labeled before any run and not used to write the prompt.
 *   Several are mixed: most details true, one important detail false.
 *
 * Ids are opaque so they carry no hint of the label.
 */
export type CaseSet = "development" | "reserved";
export type Household = "alex" | "charlotte" | "priya";

export interface FactualCase {
  id: string;
  claim: string;
}

export interface Batch {
  name: string;
  set: CaseSet;
  household: Household;
  /** Which evidence the judge gets: story batches get the log; household-and-guidance batches get the baseline and guidance. */
  evidence: "story" | "household-and-guidance";
  /**
   * Story outcomes and situations left out of the log for length, to keep each call under the provider's per-minute
   * token limit. Chosen before any run from the label sources: hours none of the batch's claims needs. Every response
   * and alert stays in, and the judge is told which hours are omitted.
   */
  omitHours?: number[];
  cases: FactualCase[];
}

export const BATCHES: Batch[] = [
  // Development: Alex, power outage.
  {
    name: "alex story A",
    set: "development",
    household: "alex",
    evidence: "story",
    omitHours: [6, 12, 18, 24],
    cases: [
      { id: "C07", claim: "Power was restored at Hour 60, but central heating did not fully recover until about six hours later (between Hour 60 and Hour 72)." },
      { id: "C02", claim: "You had a friend bring dry clothes, bottled water and a basic emergency kit to the warming center." },
      { id: "C11", claim: "You coordinated with building staff to restore power." },
      { id: "C04", claim: "At Hour 66, building management said the central heating would be fully restored in about six hours." },
      { id: "C15", claim: "Temperatures in the apartment remained near 45 °F for several days." },
    ],
  },
  {
    name: "alex story B",
    set: "development",
    household: "alex",
    evidence: "story",
    omitHours: [6, 12, 18, 24],
    cases: [
      { id: "C09", claim: "Power was restored at Hour 60, but central heating stayed unavailable and only returned during the Hour 72 turn." },
      { id: "C13", claim: "Without power, the building's central heating can remain below safe indoor temperatures (45 °F) for many hours." },
      { id: "C21", claim: "Power came back at Hour 60, yet the apartment stayed around 45 °F until the heat returned late in the exercise." },
      { id: "C18", claim: "The central heating was restored at Hour 66." },
      { id: "C25", claim: "A 1500-watt space heater you kept in the apartment repeatedly tripped the breaker." },
    ],
  },
  {
    name: "alex story C",
    set: "development",
    household: "alex",
    evidence: "story",
    omitHours: [6, 12, 18, 24],
    cases: [
      { id: "C16", claim: "Your stored water would have run out well before the 72-hour outage ended." },
      { id: "C23", claim: "You were never at risk of hypothermia." },
      { id: "C19", claim: "The breaker trips showed that the apartment's circuit cannot support high-wattage heaters." },
      { id: "C26", claim: "Building management handled the flood well." },
    ],
  },
  {
    // Accurate rewrites of three defects missed in the first run (C25, C16, C19), written 2026-10-31 for the pilot,
    // after those defects' results were seen: development cases, not validation.
    name: "alex story D",
    set: "development",
    household: "alex",
    evidence: "story",
    omitHours: [6, 12, 18, 24],
    cases: [
      { id: "C56", claim: "The story introduced a 1500-watt space heater from the building's maintenance closet." },
      { id: "C57", claim: "Your stored water, about one day's worth, would have run out well before power returned at Hour 60." },
      { id: "C58", claim: "The breaker tripped twice when you plugged in a 1500-watt space heater." },
    ],
  },
  {
    name: "alex household and guidance",
    set: "development",
    household: "alex",
    evidence: "household-and-guidance",
    cases: [
      { id: "C05", claim: "A CO alarm matters especially when using electric heaters, which may produce carbon monoxide." },
      { id: "C01", claim: "You have only 1 gallon of stored water, about one day for one adult." },
      { id: "C08", claim: "Put battery or battery-backup CO alarms near sleeping areas." },
      { id: "C22", claim: "You had no flashlights." },
      { id: "C17", claim: "A closed freezer keeps food frozen for about a week without power." },
      { id: "C24", claim: "Wet clothing makes hypothermia possible even above 40 °F." },
      { id: "C20", claim: "Electric space heaters are a poor choice for outages." },
    ],
  },

  // Reserved: Charlotte, hurricane. Labeled before any run.
  {
    name: "charlotte story A",
    set: "reserved",
    household: "charlotte",
    evidence: "story",
    omitHours: [36, 42, 48, 54, 66, 72],
    cases: [
      { id: "C41", claim: "At Hour 18 the neighbor let you run the CPAP from his gasoline generator, set up outdoors behind his house, for about six hours." },
      { id: "C33", claim: "You turned off the main gas valve, which removed the gas-leak risk." },
      { id: "C47", claim: "You drove your own car toward the shelter, but floodwater stopped it at an intersection." },
      { id: "C30", claim: "Flood water reached the second-floor hallway by Hour 12." },
      { id: "C52", claim: "Paramedics said your 10,000 mAh power bank couldn't run the 60 W CPAP on its own." },
      { id: "C38", claim: "Your portable power station ran out within the first 12 hours of the flood." },
    ],
  },
  {
    name: "charlotte story B",
    set: "reserved",
    household: "charlotte",
    evidence: "story",
    omitHours: [12, 18, 24, 30, 36, 48, 54, 60],
    cases: [
      { id: "C44", claim: "You moved everyone upstairs and turned off the main gas valve, which kept the medical device's battery from draining." },
      { id: "C35", claim: "You called the local emergency management center to ask for an air-rescue helicopter for Person 2." },
      { id: "C49", claim: "While waiting in the car, you powered the CPAP from the car's 12 V battery through an inverter." },
      { id: "C31", claim: "Clinic staff warned that the generator's fuel could run out within about two hours." },
      { id: "C55", claim: "The clinic's generator ran out of fuel at Hour 72, cutting off the CPAP." },
      { id: "C42", claim: "Calling emergency services and following the dispatcher's instructions kept Person 2's CPAP powered as long as possible." },
    ],
  },
  {
    name: "charlotte household and guidance",
    set: "reserved",
    household: "charlotte",
    evidence: "household-and-guidance",
    cases: [
      { id: "C37", claim: "You had 10 gallons of stored water, which covers about 2.5 days once the dogs are counted." },
      { id: "C50", claim: "Your household had a battery carbon monoxide detector and smoke detectors, but no first aid kit." },
      { id: "C46", claim: "Run a portable generator outdoors, at least 20 feet from windows, doors and vents." },
    ],
  },

  // Reserved: Priya, heat wave. Labeled before any run.
  {
    name: "priya story A",
    set: "reserved",
    household: "priya",
    evidence: "story",
    omitHours: [6, 22, 30, 32, 36, 38, 44, 46],
    cases: [
      { id: "C34", claim: "You drove Person 3, the bird and the medication to a cooling center, where Person 3's dizziness eased after about 20 minutes." },
      { id: "C53", claim: "You drove Person 3, the bird and the medication to a cooling center, where Person 3's dizziness eased after about two hours." },
      { id: "C39", claim: "When the carbon monoxide detector chirped, the neighbor moved the generator to the open side of the driveway." },
      { id: "C45", claim: "You had about 1 gallon of stored water left at Hour 20." },
      { id: "C32", claim: "You powered the medical device with your own portable generator." },
    ],
  },
  {
    name: "priya story B",
    set: "reserved",
    household: "priya",
    evidence: "story",
    omitHours: [0, 6, 10, 26, 36, 38, 44, 46],
    cases: [
      { id: "C48", claim: "Running the fan from the car battery through an inverter drained it, so the car wouldn't start at Hour 22." },
      { id: "C36", claim: "The medical device had power again from Hour 14 on." },
      { id: "C51", claim: "You gave the paramedics one of your spare oxygen tanks and helped move Person 3 onto a stretcher." },
      { id: "C43", claim: "The house was unsafe to stay in for the whole exercise." },
    ],
  },
  {
    name: "priya household and guidance",
    set: "reserved",
    household: "priya",
    evidence: "household-and-guidance",
    cases: [
      { id: "C40", claim: "Person 3 had 6 days of daily medication on hand." },
      { id: "C54", claim: "Heat exhaustion that lasts more than an hour needs medical help." },
      { id: "C29", claim: "For heat stroke, cool the person down and call 911 only if symptoms last more than an hour." },
    ],
  },
];

export const ALL_CASES = BATCHES.flatMap((batch) => batch.cases.map((c) => ({ ...c, set: batch.set, household: batch.household })));

/**
 * The bounded pilot (proposed 2026-10-31): the four defects the first run missed, each with its accurate rewrite,
 * two claims a call. Every call pairs one defect with the rewrite of a different defect, so no call shows both
 * versions of the same claim. All are Alex story claims, so every call carries the same evidence.
 */
export const PILOT_PAIRS = [
  { defect: "C07", rewrite: "C09" },
  { defect: "C25", rewrite: "C56" },
  { defect: "C16", rewrite: "C57" },
  { defect: "C19", rewrite: "C58" },
] as const;

export const PILOT_CALLS: string[][] = PILOT_PAIRS.map(({ defect }, i) => [defect, PILOT_PAIRS[(i + 1) % PILOT_PAIRS.length].rewrite]);

/** The pilot's calls as claim batches, with the story evidence the development story batches use. */
export function pilotBatches(): Batch[] {
  const byId = new Map(ALL_CASES.map((c) => [c.id, c]));
  return PILOT_CALLS.map((ids, i) => ({
    name: `pilot ${i + 1} of ${PILOT_CALLS.length}`,
    set: "development",
    household: "alex",
    evidence: "story",
    omitHours: [6, 12, 18, 24],
    cases: ids.map((id) => ({ id, claim: byId.get(id)!.claim })),
  }));
}

/**
 * The story-facts note is checked in its own calls, not while judging claims
 * (2026-10-31, after the note's planted value spread into claim verdicts).
 * Each check plants one false line; it counts as detected only when the judge
 * marks it inconsistent, names `detail` as the conflicting detail, and quotes
 * one of the `refutedBy` lines correctly.
 */
export interface NoteCheck {
  name: string;
  set: CaseSet;
  household: Household;
  corrupt: { find?: string; replace?: string; add?: string; detail: string; refutedBy: string[] };
}

export const NOTE_CHECKS: NoteCheck[] = [
  {
    name: "alex note",
    set: "development",
    household: "alex",
    corrupt: { find: "Power returned at Hour 60", replace: "Power returned at Hour 54", detail: "Hour 54", refutedBy: ["Hour 60 situation"] },
  },
  {
    name: "charlotte note",
    set: "reserved",
    household: "charlotte",
    corrupt: { add: "Power returned at Hour 48.", detail: "Hour 48", refutedBy: ["Hour 66 situation"] },
  },
  {
    name: "priya note",
    set: "reserved",
    household: "priya",
    corrupt: { add: "Power returned at Hour 30.", detail: "Hour 30", refutedBy: ["Hour 30 outcome", "Hour 32 outcome"] },
  },
];
