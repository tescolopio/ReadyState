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
 * model's non-breaking hyphens. It met the count and citation rules but kept
 * a kit list as an improvement and two misleading claims.
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
    "Store at least 3 gallons of water per person for a 3‑day minimum (from Hour 0‑24 where stored water covered only 1 day).",
    "Assemble a basic emergency kit that includes a sleeping bag or warm blanket, a battery‑powered NOAA radio, first‑aid supplies, a manual can opener, extra batteries, dust masks, plastic sheeting, duct tape, a whistle, and hand sanitizer (from the inventory‑check gaps and the lack of blankets noted at Hours 24‑30).",
    "Install battery‑powered smoke and CO detectors in the apartment to alert you to electrical hazards (from the missing detectors noted in the baseline and the spark event at Hour 24).",
  ],
  supply_checklist: ["Battery‑powered NOAA weather radio", "Manual can opener"],
};

describe("checkDebrief: Alex's rerun debrief", () => {
  const problems = checkDebrief(alexRerun, alexTurns);

  it("flags the embedded 11-item kit list as a list, not one action", () => {
    const list = problems.filter((p) => p.category === "suitability");
    expect(list).toHaveLength(1);
    expect(list[0].problem).toContain("Assemble a basic emergency kit");
    expect(list[0].fix).toContain("supply_checklist");
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
});

/** Alex's debrief from the fourth run, before the debrief rules. */
const alexFourthRun: AfterActionReport = {
  summary: "The apartment lacked water, food and emergency supplies.",
  went_well: ["You recognized the hypothermia risk early."],
  need_to_know: [
    "Your electric space heater (1500 W) exceeds the capacity of a standard 15‑amp circuit and will trip the breaker repeatedly; a lower‑wattage, UL‑listed heater or a portable battery‑powered heater would be safer.",
  ],
  do_better: [
    "Acquire a complete basic emergency kit, including a battery-powered or hand-crank NOAA weather radio, first aid kit, extra batteries, whistle, dust masks, plastic sheeting, duct tape, moist towelettes, garbage bags with ties, wrench or pliers for utilities, manual can opener, local maps, and hand sanitizer.",
    "Increase stored water to at least 3 gallons per person (3 days).",
    "Stock at least 3 days of non‑perishable, no‑cook food.",
    "Obtain a sleeping bag or warm blanket for each household member.",
    "Install battery‑backup smoke detectors and CO detectors in sleeping areas.",
  ],
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

  it("rejects an hour that never happened, but accepts ranges", () => {
    const wrong = { ...base, do_better: ["Buy a radio (from Hour 31: the alert you missed)"] };
    expect(checkDebrief(wrong, alexTurns)[0].problem).toContain("Hour 31, which never happened");
    const range = { ...base, do_better: ["Keep a sleeping bag ready (cold through Hours 48–66)"] };
    expect(checkDebrief(range, alexTurns)).toEqual([]);
  });

  it("accepts guidance as a source for facts to know, but not for improvements", () => {
    const fact = { ...base, need_to_know: ["A closed fridge keeps food safe about 4 hours (CDC guidance)."] };
    expect(checkDebrief(fact, alexTurns)).toEqual([]);
    const improvement = { ...base, do_better: ["Store 3 gallons of water, per CDC guidance."] };
    expect(categories(improvement)).toEqual(["citation"]);
  });

  it("checks that an event is cited, not that the advice describes it correctly", () => {
    // Hour 12 happened, so the citation is valid even though nothing here proves the advice fits it.
    const plausible = { ...base, do_better: ["Learn where your breaker panel is (from Hour 12: the hallway flood)"] };
    expect(checkDebrief(plausible, alexTurns)).toEqual([]);
  });
});

describe("repairInstructions", () => {
  it("lists exactly the failed checks, each with its fix", () => {
    const text = repairInstructions(checkDebrief(alexRerun, alexTurns));
    expect(text).toMatch(/^Your debrief failed these checks/);
    expect(text).toContain("1. Improvement is a list");
    expect(text).toContain("2. Known inaccuracy (heater-exceeds-circuit)");
    expect(text).toContain("Fix: A 1,500 W heater is within a standard 15-amp, 120 V circuit");
    expect(text.match(/^\d+\./gm)).toHaveLength(3);
  });
});
