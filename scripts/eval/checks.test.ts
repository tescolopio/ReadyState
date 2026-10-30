import { describe, expect, it } from "vitest";

import type { AfterActionReport, TurnOutput } from "@/lib/ttx";

import { contentFindings, introducedEquipment, unsafeAdvice, unsuitableDebrief, untracedDebriefPoints } from "./checks";

/**
 * Regression examples from Alex's run on 2026-10-30 (eval finding 16): it
 * passed every automatic check of the time despite these defects. Text is
 * quoted from the run, including the model's non-breaking hyphens.
 */
const alexBaseline = [
  "People: 1 adult.",
  "Location: Illinois, urban.",
  "Home: apartment, 1 floor, no basement. Heating: electric heat. Cooking: electric. Water: municipal water. Backup power: none.",
  "Stored: 1 gallon of stored water, 2 days of food.",
  "Has: flashlights or headlamps, phone power banks.",
].join("\n");

const turn = (overrides: Partial<TurnOutput>): TurnOutput => ({
  feedback: null,
  narrative_response: "",
  time_elapsed: "Hour 0",
  hours_elapsed: 0,
  new_inject: "",
  critical_alerts: [],
  suggested_actions: [],
  response_options: [],
  scenario_status: "ongoing",
  ...overrides,
});

const alexTurns = [
  turn({ time_elapsed: "Hour 0", hours_elapsed: 0 }),
  turn({
    time_elapsed: "Hour 12",
    hours_elapsed: 12,
    new_inject:
      "You notice a faint smell of mildew and hear a low humming from the building's emergency generator that has just started, but the generator is located in a basement area you cannot access without the elevator.",
  }),
  turn({
    time_elapsed: "Hour 66",
    hours_elapsed: 66,
    response_options: [
      "I go back to my apartment alone right away, find an electric space heater in the unit, and try to heat the space despite the low temperature.",
      "I stay with my neighbor, who has a working heater, until the central heat returns.",
    ],
  }),
];

const alexDebrief: AfterActionReport = {
  summary: "The exercise highlighted that the apartment's lack of sufficient water, food, and emergency supplies created risk.",
  went_well: ["You recognized the hypothermia risk early."],
  need_to_know: [
    "Your electric space heater (1500 W) exceeds the capacity of a standard 15‑amp circuit and will trip the breaker repeatedly; a lower‑wattage, UL‑listed heater or a portable battery‑powered heater would be safer.",
    "Water intrusion can raise floor temperature and cause hypothermia even in indoor spaces; wet clothing dramatically increases heat loss.",
  ],
  do_better: [
    "Acquire a complete basic emergency kit, including a battery-powered or hand-crank NOAA weather radio, first aid kit, extra batteries, whistle, dust masks, plastic sheeting, duct tape, moist towelettes, garbage bags with ties, wrench or pliers for utilities, manual can opener, local maps, and hand sanitizer.",
    "Increase stored water to at least 3 gallons per person (3 days) and add additional containers for emergencies.",
    "Stock at least 3 days of non‑perishable, no‑cook food and a method to open canned goods without electricity.",
    "Obtain a sleeping bag or warm blanket rated for near‑freezing temperatures for each household member.",
    "Install battery‑backup smoke detectors and CO detectors in sleeping areas and test them regularly.",
  ],
  supply_checklist: [],
};

describe("Alex's 2026-10-30 defects are caught", () => {
  it("flags equipment the story introduced: the space heater and the building generator", () => {
    const flagged = introducedEquipment(alexBaseline, alexTurns, []);
    expect(flagged).toHaveLength(2);
    expect(flagged[0]).toContain('Hour 12: "generator"');
    expect(flagged[1]).toContain('Hour 66: "space heater"');
  });

  it("doesn't flag equipment obtained from a neighbor, or listed in the baseline", () => {
    expect(introducedEquipment(alexBaseline, [alexTurns[2]], []).join()).not.toContain("working heater");
    expect(introducedEquipment(`${alexBaseline}\nHas: a space heater.`, [alexTurns[2]], [])).toEqual([]);
  });

  it("flags the battery-powered heater, and an electric heater recommended for outages", () => {
    expect(unsafeAdvice(alexDebrief.need_to_know)).toEqual([expect.stringContaining("outage-appropriate-heating")]);
    expect(unsafeAdvice(["Obtain a safe, UL‑listed portable electric heater for future power outages."])).toHaveLength(1);
    expect(unsafeAdvice(["An electric heater won't help in a power outage; use blankets and a sleeping bag."])).toEqual([]);
  });

  it("flags debrief points that don't trace to an event", () => {
    expect(untracedDebriefPoints(alexDebrief, alexTurns)).toHaveLength(7);
    const traced = {
      ...alexDebrief,
      need_to_know: ["Stairs are your only way out without power (from Hour 0: the elevator stopping)"],
      do_better: ["Store two more gallons of water this week (from your household profile: 1 gallon stored)"],
    };
    expect(untracedDebriefPoints(traced, alexTurns)).toEqual([]);
    const wrongHour = { ...traced, do_better: ["Buy a radio (from Hour 30: the alert you missed)"] };
    expect(untracedDebriefPoints(wrongHour, alexTurns)).toEqual([expect.stringContaining("Hour 30, which never happened")]);
  });

  it("flags more than three improvements, and a checklist posing as one", () => {
    const problems = unsuitableDebrief(alexDebrief);
    expect(problems[0]).toBe("Debrief lists 5 improvements (at most 3)");
    expect(problems[1]).toContain("reads like a checklist");
  });

  it("files each problem under its own category", () => {
    const categories = new Set(
      contentFindings({ baseline: alexBaseline, turns: alexTurns, participantText: [], report: alexDebrief }).map(
        (f) => f.category,
      ),
    );
    expect([...categories].sort()).toEqual(["continuity", "safety", "suitability"]);
  });

  it.todo("flags physically wrong explanations such as 'water intrusion can raise floor temperature' (needs the model judge, G11)");
});

describe("a clean debrief", () => {
  it("passes every content check", () => {
    const clean: AfterActionReport = {
      summary: "Water and warmth were the pressure points.",
      went_well: ["You layered clothes early (Hour 0)."],
      need_to_know: ["Stairs are your only way out without power (from Hour 0: the elevator stopping)"],
      do_better: [
        "Store two more gallons of water this week (from your household profile: 1 gallon stored)",
        "Put a sleeping bag on your next shopping list (from Hour 0: the apartment cooling)",
      ],
      supply_checklist: ["Hand-crank radio", "Manual can opener"],
    };
    expect(contentFindings({ baseline: alexBaseline, turns: alexTurns.slice(0, 1), participantText: [], report: clean })).toEqual([]);
  });
});
