import { describe, expect, it } from "vitest";

import type { AfterActionReport, TurnOutput } from "@/lib/ttx";

import { contentFindings, introducedEquipment, unsafeAdvice } from "./checks";

/**
 * Regression examples from Alex's run on 2026-10-30 (eval finding 16): it
 * passed every automatic check of the time despite these defects. Text is
 * quoted from the run, including the model's non-breaking hyphens. Debrief
 * regressions are in lib/debrief-checks.test.ts.
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
    suggested_actions: ["Obtain a safe, UL‑listed portable electric heater for future power outages."],
  }),
];

const debrief: AfterActionReport = {
  summary: "Water and warmth were the pressure points.",
  went_well: ["You layered clothes early (Hour 0)."],
  need_to_know: ["Stairs are your only way out without power (from Hour 0: the elevator stopping)"],
  do_better: [
    {
      action: "Store two more gallons of water this week",
      evidence: "household profile: 1 gallon stored",
      why: "One gallon lasts one person a day.",
    },
  ],
  supply_checklist: ["Hand-crank radio", "Manual can opener"],
};

describe("Alex's 2026-10-30 turn defects are caught", () => {
  it("flags equipment the story introduced: the space heater and the building generator", () => {
    const flagged = introducedEquipment(alexBaseline, alexTurns, []);
    expect(flagged).toHaveLength(2);
    expect(flagged[0]).toContain('Hour 12: "generator"');
    expect(flagged[1]).toContain('Hour 66: "space heater"');
  });

  it("still flags equipment the participant only found, from an offered option (Alex, 2026-10-31)", () => {
    const chosen = ["I go back to my apartment alone right away, find an electric space heater in the unit, and try to heat the space."];
    expect(introducedEquipment(alexBaseline, [alexTurns[2]], chosen)[0]).toContain('"space heater"');
    expect(introducedEquipment(alexBaseline, [alexTurns[2]], ["I plug in the space heater I keep in the closet."])).toEqual([]);
  });

  it("doesn't flag equipment obtained from a neighbor, or listed in the baseline", () => {
    expect(introducedEquipment(alexBaseline, [alexTurns[2]], []).join()).not.toContain("working heater");
    expect(introducedEquipment(`${alexBaseline}\nHas: a space heater.`, [alexTurns[2]], [])).toEqual([]);
  });

  it("flags an electric heater recommended for outages, but not a warning against one", () => {
    expect(unsafeAdvice(["Obtain a safe, UL‑listed portable electric heater for future power outages."])).toHaveLength(1);
    expect(unsafeAdvice(["An electric heater won't help in a power outage; use blankets and a sleeping bag."])).toEqual([]);
  });

  it.todo("flags physically wrong explanations such as 'water intrusion can raise floor temperature' (needs the model judge, G11)");
});

describe("contentFindings", () => {
  it("files new-output problems by category", () => {
    const findings = contentFindings({ baseline: alexBaseline, turns: alexTurns, participantText: [], report: debrief });
    expect([...new Set(findings.map((f) => f.category))].sort()).toEqual(["continuity", "safety"]);
    expect(findings.every((f) => !f.replayed)).toBe(true);
  });

  it("keeps defects of replayed turns in the record, marked as known, and still checks the new debrief", () => {
    const findings = contentFindings({
      baseline: alexBaseline,
      turns: alexTurns,
      participantText: [],
      report: { ...debrief, do_better: [{ action: "Store 3 gallons of water", evidence: "CDC guidance", why: "It lasts three days." }] },
      replayedTurns: alexTurns.length,
    });
    const known = findings.filter((f) => f.replayed);
    expect(known.map((f) => f.category).sort()).toEqual(["continuity", "continuity", "safety"]);
    // The new debrief's untraced improvement counts against new output.
    expect(findings.filter((f) => !f.replayed).map((f) => f.category)).toEqual(["citation"]);
  });

  it("passes a clean run", () => {
    expect(contentFindings({ baseline: alexBaseline, turns: alexTurns.slice(0, 1), participantText: [], report: debrief })).toEqual([]);
  });
});
