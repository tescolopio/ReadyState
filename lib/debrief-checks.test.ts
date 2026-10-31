import { describe, expect, it } from "vitest";

import { checkDebrief, repairInstructions } from "@/lib/debrief-checks";
import type { AfterActionReport, TurnOutput } from "@/lib/ttx";

const turnAt = (hours: number): TurnOutput => ({
  feedback: null,
  narrative_response: "",
  time_elapsed: `Hour ${hours}`,
  hours_elapsed: hours,
  new_inject: "",
  critical_alerts: [],
  suggested_actions: [],
  response_options: [],
  scenario_status: "ongoing",
});
/** Alex's run: a turn every 6 hours to Hour 72. */
const alexTurns = Array.from({ length: 13 }, (_, i) => turnAt(i * 6));

const categories = (report: AfterActionReport) => checkDebrief(report, alexTurns).map((p) => p.category);

/**
 * Alex's debrief from the targeted rerun on 2026-10-30, quoted with the
 * model's non-breaking hyphens and split into the structured improvement
 * fields. It met the count and citation rules but kept a kit list as an
 * improvement and two misleading claims.
 */
const alexRerun: AfterActionReport = {
  summary: "During the 72‑hour simulated outage you responded quickly to flooding and used a warming center.",
  went_well: ["You called 911 promptly when flooding created an electrical hazard (Hour 18)."],
  need_to_know: [
    "A 1500‑watt space heater can exceed the capacity of a standard residential circuit and cause the breaker to trip, leaving you without power when you need it most (observed at Hour 72).",
    "Your refrigerator can keep food safe for only about 4 hours without power, after which perishables should be discarded (CDC/FEMA guidance applied to the extended outage scenario).",
    "The building’s central heating may take several hours to come back online after a power outage, so you must have alternative warming methods such as extra blankets, layered clothing, and a safe heat source that does not overload circuits (experienced at Hours 48‑66).",
  ],
  do_better: [
    {
      action: "Store at least 3 gallons of water per person for a 3‑day minimum.",
      evidence: "Hour 0‑24, where stored water covered only 1 day",
      why: "Your one gallon ran out on the first day.",
    },
    {
      action:
        "Assemble a basic emergency kit that includes a sleeping bag or warm blanket, a battery‑powered NOAA radio, first‑aid supplies, a manual can opener, extra batteries, dust masks, plastic sheeting, duct tape, a whistle, and hand sanitizer.",
      evidence: "the inventory‑check gaps and the lack of blankets noted at Hours 24‑30",
      why: "You had no blankets when the apartment got cold.",
    },
    {
      action: "Install battery‑powered smoke and CO detectors in the apartment to alert you to electrical hazards.",
      evidence: "the missing detectors noted in the baseline and the spark event at Hour 24",
      why: "The apartment had no detectors.",
    },
  ],
  supply_checklist: ["Battery‑powered NOAA weather radio", "Manual can opener"],
};

describe("checkDebrief: Alex's rerun debrief", () => {
  const problems = checkDebrief(alexRerun, alexTurns);

  it("flags the 11-item kit list in an action field: the structure alone doesn't prevent it", () => {
    const list = problems.filter((p) => p.category === "suitability");
    expect(list).toHaveLength(1);
    expect(list[0].problem).toContain("Improvement's action is a list");
    expect(list[0].problem).toContain("Assemble a basic emergency kit");
    expect(list[0].fix).toContain("supply_checklist");
    expect(list[0].fix).toContain("or drop this improvement");
  });

  it("flags the misleading heater-circuit and detector claims as known inaccuracies", () => {
    const accuracy = problems.filter((p) => p.category === "accuracy").map((p) => p.problem);
    expect(accuracy).toEqual([
      expect.stringContaining("heater-exceeds-circuit"),
      expect.stringContaining("detectors-electrical-hazards"),
    ]);
  });

  it("finds its citations valid: every point cites something, and every cited hour happened", () => {
    expect(problems.filter((p) => p.category === "citation")).toEqual([]);
  });

  it("finds nothing else: these are the only failures", () => {
    expect(problems).toHaveLength(3);
  });

  it("passes with the kit list dropped and the claims fixed, though only two improvements remain", () => {
    const repaired: AfterActionReport = {
      ...alexRerun,
      need_to_know: alexRerun.need_to_know.slice(1),
      do_better: [
        alexRerun.do_better[0],
        { ...alexRerun.do_better[2], action: "Install battery‑powered smoke and CO alarms in the apartment." },
      ],
    };
    expect(checkDebrief(repaired, alexTurns)).toEqual([]);
  });
});

/** Alex's debrief from the fourth run, before the debrief rules and structured improvements. */
const alexFourthRun: AfterActionReport = {
  summary: "The apartment lacked water, food and emergency supplies.",
  went_well: ["You recognized the hypothermia risk early."],
  need_to_know: [
    "Your electric space heater (1500 W) exceeds the capacity of a standard 15‑amp circuit and will trip the breaker repeatedly; a lower‑wattage, UL‑listed heater or a portable battery‑powered heater would be safer.",
  ],
  // It had no evidence or reasons.
  do_better: [
    "Acquire a complete basic emergency kit, including a battery-powered or hand-crank NOAA weather radio, first aid kit, extra batteries, whistle, dust masks, plastic sheeting, duct tape, moist towelettes, garbage bags with ties, wrench or pliers for utilities, manual can opener, local maps, and hand sanitizer.",
    "Increase stored water to at least 3 gallons per person (3 days).",
    "Stock at least 3 days of non‑perishable, no‑cook food.",
    "Obtain a sleeping bag or warm blanket for each household member.",
    "Install battery‑backup smoke detectors and CO detectors in sleeping areas.",
  ].map((action) => ({ action, evidence: "", why: "" })),
  supply_checklist: [],
};

describe("checkDebrief: Alex's fourth-run debrief", () => {
  it("fails every category", () => {
    expect(new Set(categories(alexFourthRun))).toEqual(new Set(["suitability", "citation", "safety", "accuracy"]));
  });

  it("flags more than three improvements", () => {
    expect(checkDebrief(alexFourthRun, alexTurns)[0].problem).toBe("do_better has 5 improvements");
  });
});

describe("checkDebrief: citations", () => {
  const base: AfterActionReport = { ...alexRerun, need_to_know: [], do_better: [], supply_checklist: [] };
  const improvement = (evidence: string, why = "It matters here."): AfterActionReport => ({
    ...base,
    do_better: [{ action: "Buy a battery radio this week.", evidence, why }],
  });

  it("rejects an hour that never happened, but accepts ranges", () => {
    expect(checkDebrief(improvement("Hour 31: the alert you missed"), alexTurns)[0].problem).toContain(
      "Hour 31, which never happened",
    );
    expect(checkDebrief(improvement("cold through Hours 48–66"), alexTurns)).toEqual([]);
  });

  it("checks hours cited in an improvement's reason, too", () => {
    expect(categories(improvement("Hour 30: the outage", "You missed the alert at Hour 31."))).toEqual(["citation"]);
  });

  it("rejects missing evidence", () => {
    expect(checkDebrief(improvement(""), alexTurns)[0].problem).toContain('"(empty)"');
  });

  it("accepts guidance as a source for facts to know, but not as an improvement's evidence", () => {
    const fact = { ...base, need_to_know: ["A closed fridge keeps food safe about 4 hours (CDC guidance)."] };
    expect(checkDebrief(fact, alexTurns)).toEqual([]);
    expect(categories(improvement("CDC guidance"))).toEqual(["citation"]);
  });

  it("checks that an event is cited, not that the advice describes it correctly", () => {
    // Hour 12 happened, so the evidence is valid even though nothing here proves the advice fits it.
    expect(checkDebrief(improvement("Hour 12: the hallway flood"), alexTurns)).toEqual([]);
  });
});

describe("checkDebrief: structured improvements", () => {
  const base: AfterActionReport = { ...alexRerun, need_to_know: [], do_better: [], supply_checklist: [] };

  it("flags a list hidden in the reason", () => {
    const hidden: AfterActionReport = {
      ...base,
      do_better: [
        {
          action: "Build a kit this month.",
          evidence: "Hour 24: the dark hallway",
          why: "You needed water, food, a radio, flashlights and batteries.",
        },
      ],
    };
    expect(checkDebrief(hidden, alexTurns).map((p) => p.problem)).toEqual([expect.stringContaining("Improvement's why is a list")]);
  });

  it("applies the safety and accuracy checks to every field", () => {
    const heater: AfterActionReport = {
      ...base,
      do_better: [
        {
          action: "Buy a battery-powered heater for outages.",
          evidence: "Hour 48: the cold apartment",
          why: "A 1500 W space heater overloads a standard circuit.",
        },
      ],
    };
    expect(categories(heater).sort()).toEqual(["accuracy", "safety"]);
  });
});

describe("repairInstructions", () => {
  const text = repairInstructions(checkDebrief(alexRerun, alexTurns));

  it("lists exactly the failed checks, each with its fix", () => {
    expect(text).toMatch(/^Your debrief failed these checks/);
    expect(text).toContain("1. Improvement's action is a list");
    expect(text).toContain("2. Known inaccuracy (heater-exceeds-circuit)");
    expect(text).toContain("Fix: A 1,500 W heater is within a standard 15-amp, 120 V circuit");
    expect(text.match(/^\d+\./gm)).toHaveLength(3);
  });

  it("permits dropping a failing improvement rather than replacing it", () => {
    expect(text).toContain("You may drop a failing improvement instead of fixing it");
    expect(text).toContain("don't replace a dropped one with a new one");
  });
});
