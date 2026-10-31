import { describe, expect, it } from "vitest";

import { introducedEquipment } from "@/lib/continuity";
import { checkDebrief, electricalConclusion, omitKitImprovement, repairInstructions, storyDefects, unsupportedInterval, vagueHeating } from "@/lib/debrief-checks";
import saved from "@/lib/fixtures/alex-2026-10-31-0407-drafts.json";
import saved1135 from "@/lib/fixtures/alex-2026-10-31-1135-drafts.json";
import saved1142 from "@/lib/fixtures/alex-2026-10-31-1142-drafts.json";
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

  it("flags the misleading heater-circuit and detector claims as known inaccuracies, and the stated cause of the trip", () => {
    const accuracy = problems.filter((p) => p.category === "accuracy");
    expect(accuracy.map((p) => p.check)).toEqual([
      "accuracy:heater-exceeds-circuit",
      "accuracy:unsupported-electrical-conclusion",
      "accuracy:detectors-electrical-hazards",
    ]);
    expect(accuracy[1]).toMatchObject({ field: "need_to_know[0]", matched: expect.stringContaining("cause the breaker to trip") });
  });

  it("finds its citations valid: every point cites something, and every cited hour happened", () => {
    expect(problems.filter((p) => p.category === "citation")).toEqual([]);
  });

  it("finds nothing else: these are the only failures", () => {
    expect(problems).toHaveLength(4);
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
          action: "Get ready for the next outage this month.",
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
    expect(new Set(categories(heater))).toEqual(new Set(["accuracy", "safety"]));
  });
});

/**
 * Alex's debrief from the structured-improvements rerun on 2026-10-31. It
 * passed every check of the time; these defects were found by reading it.
 * The turns quote the run where the checks depend on them.
 */
const alex31Baseline = [
  "People: 1 adult.",
  "Home: apartment, 1 floor, no basement. Heating: electric heat. Cooking: electric. Water: municipal water. Backup power: none.",
  "Stored: 1 gallon of stored water, 2 days of food.",
  "Has: flashlights or headlamps, phone power banks.",
  "Emergency to practice: extended power outage.",
].join("\n");
const alex31Turns = alexTurns.map((turn) => {
  if (turn.hours_elapsed === 60) {
    return {
      ...turn,
      narrative_response: "Power is restored but the building’s central heating is slow to recover, keeping indoor temperatures around 45 °F.",
      response_options: [
        "I go back to my apartment alone right away, find an electric space heater in the unit, and try to heat the space despite the low temperature.",
      ],
    };
  }
  if (turn.hours_elapsed === 72) {
    return {
      ...turn,
      narrative_response:
        "You locate a small 1500‑watt space heater stored in the building’s maintenance closet and plug it into an outlet near the living‑room sofa. Within about 10 minutes the circuit breaker trips, cutting power to the heater and the apartment lights.",
    };
  }
  return turn;
});
/** The participant's responses, `responses[i]` after `alexTurns[i]`. */
const responsesAfter = (byHour: Record<number, string>) => alexTurns.map((turn) => byHour[turn.hours_elapsed] ?? "");
/** After Hour 60 the participant chose the option that found the heater, which doesn't establish it. */
const alex31Context = {
  baseline: alex31Baseline,
  participantText: responsesAfter({
    60: "I go back to my apartment alone right away, find an electric space heater in the unit, and try to heat the space despite the low temperature.",
  }),
};
const alex31: AfterActionReport = {
  summary:
    "The exercise revealed critical gaps in water, food, and emergency supplies, and highlighted the challenges of heating a damp apartment without adequate power capacity. However, reliance on a high‑wattage space heater overloaded the circuit, and the delayed central heating left you exposed to cold for several hours.",
  went_well: [
    "You turned off the main breaker when water contacted outlets, preventing electrical shock (Hour 30).",
    "You monitored the heater’s impact on the circuit and called maintenance when breakers tripped (Hour 72).",
  ],
  need_to_know: [
    "Your apartment’s electric circuit cannot sustain a 1500‑W heater continuously; high‑wattage heaters will trip breakers (Hour 72).",
    "You have only 1 gallon of stored water, covering roughly one day for one adult, which is below the three‑day minimum recommended for power outages (Baseline).",
    "No smoke detectors were recorded in the apartment, a required safety device for fire and carbon monoxide detection (Baseline gaps).",
  ],
  do_better: [
    {
      action: "Store at least 3 gallons of water for a minimum three‑day supply.",
      evidence: "Baseline: only 1 gallon stored (Hour 0‑12 water use) and later water shortage concerns during flood.",
      why: "Ensures adequate hydration when municipal water is unavailable, meeting CDC/FEMA guidelines.",
    },
    {
      action: "Assemble a basic emergency kit.",
      evidence: "Inventory check identified 10 of 12 kit items missing; these were never acquired during the exercise.",
      why: "Provides essential tools and supplies for sheltering in place, utility shut‑off, and receiving alerts during outages.",
    },
    {
      action:
        "Obtain a heating solution compatible with the apartment’s electrical capacity, such as a low‑wattage (e.g., 750‑W) space heater used on a dedicated circuit.",
      evidence: "Hour 72: 1500‑W heater repeatedly tripped the breaker, limiting indoor heating until central heat returned.",
      why: "Prevents circuit overload and ensures reliable warmth without risking electrical fire or hypothermia.",
    },
  ],
  supply_checklist: ["3 gallons of stored water", "Warm blankets or sleeping bags for each occupant", "Smoke detector with battery backup"],
};

describe("checkDebrief: Alex's 2026-10-31 debrief", () => {
  const problems = checkDebrief(alex31, alex31Turns, alex31Context);
  const about = (text: string) => problems.filter((p) => p.problem.includes(text));

  it("rejects points that rely on the space heater the story invented, though the event is in the log", () => {
    const premise = problems.filter((p) => p.category === "continuity");
    expect(premise.map((p) => p.field)).toEqual(["summary", "need_to_know[0]", "went_well[1]", "do_better[2].evidence"]);
    expect(premise.every((p) => p.check === "invented-premise")).toBe(true);
    expect(premise[0].problem).toContain("Relies on the space heater, which the story introduced at Hour 60");
    expect(premise[0].matched).toContain("high‑wattage space heater overloaded");
  });

  it("applies the outage-heating rule from the scenario, though the sentence never says outage", () => {
    expect(problems.filter((p) => p.category === "safety").map((p) => p.problem)).toEqual([
      expect.stringContaining("Recommends grid-powered heat in a power-outage exercise"),
    ]);
    expect(about("Recommends grid-powered heat")[0].problem).toContain("750‑W) space heater");
  });

  it("rejects the vague kit action", () => {
    expect(about("whole kit, not a specific first step")).toHaveLength(1);
    expect(about("whole kit")[0].fix).toContain("or drop this improvement");
  });

  it("rejects the smoke-alarm/CO confusion", () => {
    expect(about("smoke-alarm-detects-co")).toHaveLength(1);
  });

  it("rejects electrical conclusions the narrated breaker trip doesn't support", () => {
    const electrical = problems.filter((p) => p.check === "accuracy:unsupported-electrical-conclusion");
    expect(electrical.map((p) => [p.field, p.matched])).toEqual([
      ["summary", "overloaded"],
      ["need_to_know[0]", "cannot sustain"],
      ["do_better[2].action", "electrical capacity"],
    ]);
    expect(problems.find((p) => p.check === "accuracy:purchase-on-trip")).toMatchObject({ field: "do_better[2].action" });
    expect(electrical[0].fix).not.toMatch(/80 ?%/);
  });

  it("doesn't reject the repair's correct statement that electric heat is unavailable in an outage (false positive, 2026-10-31)", () => {
    const correct = {
      ...alex31,
      summary: "Gaps in water and warmth showed.",
      went_well: [],
      need_to_know: [
        "Electric heating (central heat or space heaters) is unavailable during a power outage; you need non‑electric warmth sources such as layered clothing and blankets (Hour 0).",
      ],
      do_better: [],
    };
    expect(checkDebrief(correct, alex31Turns, alex31Context)).toEqual([]);
  });

  it("rejects the repair's causal breaker claim", () => {
    const causal = {
      ...alex31,
      summary: "Gaps in water and warmth showed.",
      need_to_know: ["The 1500‑watt space heater caused the circuit breaker to trip, showing that high‑draw electric heaters are risky (Hour 72)."],
      went_well: [],
      do_better: [],
    };
    expect(checkDebrief(causal, alex31Turns, alex31Context).map((p) => p.category).sort()).toEqual(["accuracy", "continuity"]);
  });

  it("passes once the heater, the kit action and the claims are gone, with one improvement left", () => {
    const repaired: AfterActionReport = {
      ...alex31,
      summary: "The exercise revealed gaps in water, food and warmth, and the slow return of central heat left you cold for hours.",
      went_well: [alex31.went_well[0]],
      need_to_know: [
        alex31.need_to_know[1],
        "No smoke or CO alarms were recorded; a smoke alarm detects smoke, and a CO alarm detects carbon monoxide (Baseline gaps).",
      ],
      do_better: [alex31.do_better[0]],
    };
    expect(checkDebrief(repaired, alex31Turns, alex31Context)).toEqual([]);
  });
});

describe("checkDebrief: smoke and CO alarms", () => {
  const base: AfterActionReport = { ...alexRerun, need_to_know: [], do_better: [], supply_checklist: [] };
  const fact = (text: string) => categories({ ...base, need_to_know: [`${text} (Baseline gaps)`] });

  it("flags a smoke alarm described as detecting carbon monoxide", () => {
    expect(fact("A smoke alarm will warn you of carbon monoxide.")).toEqual(["accuracy"]);
  });

  it("allows an explicitly identified combination alarm, or a CO alarm named as its own device", () => {
    expect(fact("Install a combination smoke/CO alarm, which detects both smoke and carbon monoxide.")).toEqual([]);
    expect(fact("Install smoke and CO alarms near the bedroom.")).toEqual([]);
    expect(fact("Smoke alarms detect smoke; a CO alarm detects carbon monoxide.")).toEqual([]);
  });
});

describe("checkDebrief: kit actions", () => {
  const base: AfterActionReport = { ...alexRerun, need_to_know: [], do_better: [], supply_checklist: [] };
  const action = (text: string) => categories({ ...base, do_better: [{ action: text, evidence: "Hour 30: the missed alert", why: "You had no alerts." }] });

  it("rejects a kit or supplies with no specific first step, with or without a checklist", () => {
    expect(action("Assemble a basic emergency kit.")).toEqual(["suitability"]);
    expect(action("Stock up on emergency supplies.")).toEqual(["suitability"]);
    expect(action("Put together a go-bag.")).toEqual(["suitability"]);
  });

  it("accepts a kit started with a specific item", () => {
    expect(action("Start a kit with a battery radio this week.")).toEqual([]);
    expect(action("Buy a first-aid kit this week.")).toEqual([]);
  });
});

describe("checkDebrief: scenario context for heating", () => {
  const base: AfterActionReport = { ...alexRerun, need_to_know: [], do_better: [], supply_checklist: [] };
  const heater: AfterActionReport = {
    ...base,
    do_better: [{ action: "Buy a ceramic space heater for the bedroom.", evidence: "Hour 48: the cold bedroom", why: "It warms one room." }],
    supply_checklist: ["Electric blanket"],
  };
  const outage = { baseline: "Emergency to practice: extended power outage." };

  it("flags grid-powered heat in the action and the checklist of an outage exercise", () => {
    const problems = checkDebrief(heater, alexTurns, outage).map((p) => p.problem);
    expect(problems).toEqual([
      expect.stringContaining('"Buy a ceramic space heater'),
      expect.stringContaining('"Electric blanket"'),
    ]);
  });

  it("recognizes an outage the story developed, not only the chosen emergency", () => {
    const turns = alexTurns.map((turn) => (turn.hours_elapsed === 12 ? { ...turn, new_inject: "The ice brings down a line and the power goes out." } : turn));
    expect(checkDebrief(heater, turns, { baseline: "Emergency to practice: winter storm." })).toHaveLength(2);
  });

  it("flags low-wattage heat in the summary, with no heater named (captured first draft, 2026-10-31 04:07)", () => {
    const summary = "Installing smoke/CO detectors and ensuring a reliable source of low‑wattage heat or alternative warming methods would further reduce risk in future outages.";
    expect(checkDebrief({ ...base, summary }, alexTurns, outage).map((p) => [p.check, p.field, p.matched])).toEqual([
      ["outage-grid-heat", "summary", "low‑wattage heat"],
    ]);
  });

  it("doesn't apply without an outage, or to a warning against grid heat", () => {
    expect(checkDebrief(heater, alexTurns, { baseline: "Emergency to practice: winter storm." })).toEqual([]);
    const warning = { ...base, need_to_know: ["A space heater won't help when the power is out (Hour 12)."] };
    expect(checkDebrief(warning, alexTurns, outage)).toEqual([]);
  });
});

describe("checkDebrief: invented premises", () => {
  const base: AfterActionReport = { ...alexRerun, need_to_know: [], do_better: [], supply_checklist: [] };

  it("allows recommending to obtain an item the story invented, and saying the household lacks it", () => {
    const report: AfterActionReport = {
      ...base,
      need_to_know: ["You have no space heater of your own (Baseline)."],
      do_better: [{ action: "Buy a sleeping bag this week.", evidence: "Hour 48: the cold apartment", why: "It keeps you warm without power." }],
    };
    expect(checkDebrief(report, alex31Turns, alex31Context).filter((p) => p.category === "continuity")).toEqual([]);
  });

  it("counts an item the participant said they have", () => {
    const report: AfterActionReport = { ...base, need_to_know: ["Your space heater tripped the breaker (Hour 72)."] };
    const context = { ...alex31Context, participantText: ["I plug in the space heater I keep in the closet."] };
    expect(checkDebrief(report, alex31Turns, context).filter((p) => p.category === "continuity")).toEqual([]);
  });
});

describe("equipment provenance", () => {
  const after60 = (text: string) => ({ ...alex31Context, participantText: responsesAfter({ 60: text }) });
  const defects = (context: { baseline: string; participantText: string[] }) => storyDefects(alex31Turns, context).map((d) => d.item);
  const relies: AfterActionReport = {
    ...alexRerun,
    need_to_know: ["Your space heater warmed the living room until the breaker tripped (Hour 72)."],
    do_better: [],
    supply_checklist: [],
  };

  it("treats choosing the story's option to find equipment as adopting the invention, not owning it", () => {
    expect(defects(alex31Context)).toEqual(["space heater"]);
    expect(defects(after60("I find the space heater and plug it in."))).toEqual(["space heater"]);
  });

  it("doesn't count an option's own wording, such as 'my', as the participant's claim", () => {
    const turns = alex31Turns.map((turn) => (turn.hours_elapsed === 60 ? { ...turn, response_options: ["I plug in my space heater by the sofa."] } : turn));
    const context = { ...alex31Context, participantText: responsesAfter({ 60: "I plug in my space heater by the sofa." }) };
    expect(storyDefects(turns, context).map((d) => d.item)).toEqual(["space heater"]);
  });

  it("lets finding equipment establish it when the participant claims it in their own words", () => {
    const context = after60("I find my old space heater in the hall closet and plug it in.");
    expect(defects(context)).toEqual([]);
    expect(introducedEquipment(context.baseline, alex31Turns, context.participantText)[0]).toMatchObject({ item: "space heater", establishedLater: "Hour 60" });
    expect(checkDebrief(relies, alex31Turns, context).filter((p) => p.category === "continuity")).toEqual([]);
  });

  it("counts equipment the participant obtained, or brought up before the story did", () => {
    expect(defects(after60("I borrow a space heater from my neighbor down the hall."))).toEqual([]);
    const first = { ...alex31Context, participantText: responsesAfter({ 12: "I set up a space heater in the bedroom." }) };
    expect(introducedEquipment(first.baseline, alex31Turns, first.participantText)).toEqual([]);
  });

  it("still rejects reliance on equipment nobody established", () => {
    expect(checkDebrief(relies, alex31Turns, alex31Context).map((p) => p.check)).toContain("invented-premise");
  });
});

describe("checkDebrief: electrical conclusions", () => {
  const base: AfterActionReport = { ...alexRerun, need_to_know: [], do_better: [], supply_checklist: [] };
  const fact = (text: string) => checkDebrief({ ...base, need_to_know: [text] }, alexTurns).map((p) => `${p.check} ${p.problem}`);

  it("allows descriptions of what happened, and reasons for the participant's actions", () => {
    expect(fact("The breaker tripped and the lights went out (Hour 72).")).toEqual([]);
    expect(fact("You called maintenance because the breaker tripped (Hour 72).")).toEqual([]);
    expect(fact("When the breaker tripped, you reset it and switched to blankets (Hour 72).")).toEqual([]);
    expect(fact("The breaker panel is in the hallway, and you couldn't reach it in the dark (Hour 30).")).toEqual([]);
  });

  it("allows saying equipment won't work without power, and advice not to overload circuits", () => {
    expect(fact("Outlets won't power anything during an outage (Hour 0).")).toEqual([]);
    expect(fact("Electric heat won't run while the power is out, so plan warmth that doesn't need outlets (Hour 0).")).toEqual([]);
    expect(fact("Avoid overloading circuits with extra devices (Hour 72).")).toEqual([]);
  });

  it("rejects stated causes, capacity claims, predictions and generalizations", () => {
    const kinds = [
      "The heater caused the breaker to trip (Hour 72).",
      "The breaker tripped because the heater drew too much current (Hour 72).",
      "Your circuit can't handle more than one heater (Hour 72).",
      "Use a dedicated circuit for heating (Hour 72).",
      "Plugging in a kettle will trip the breaker again (Hour 72).",
      "The trip shows that your apartment's wiring is undersized (Hour 72).",
    ].map((text) => fact(text).join().match(/\((cause|capacity|prediction|generalization)\)/)?.[1]);
    expect(kinds).toEqual(["cause", "cause", "capacity", "capacity", "prediction", "generalization"]);
  });

  it("rejects a purchase of electrical gear based on the trip, but not non-grid supplies", () => {
    const buy = (action: string) =>
      checkDebrief({ ...base, do_better: [{ action, evidence: "Hour 72: the breaker tripped and the lights went out", why: "You were left in the dark." }] }, alexTurns).map(
        (p) => p.check,
      );
    expect(buy("Buy a battery lantern this week.")).toEqual([]);
    expect(buy("Buy a surge protector this week.")).toEqual(["accuracy:purchase-on-trip"]);
  });
});

describe("repairInstructions", () => {
  const text = repairInstructions(checkDebrief(alexRerun, alexTurns));

  it("lists exactly the failed checks, each with its fix", () => {
    expect(text).toMatch(/^Your debrief failed these checks/);
    expect(text).toContain("1. Improvement's action is a list");
    expect(text).toContain("2. Known inaccuracy (heater-exceeds-circuit)");
    expect(text).toContain("Fix: The exercise narrated a breaker trip");
    expect(text.match(/^\d+\./gm)).toHaveLength(4);
    expect(text).toContain("(in do_better[1].action)");
  });

  it("permits dropping a failing improvement rather than replacing it", () => {
    expect(text).toContain("You may drop a failing improvement instead of fixing it");
    expect(text).toContain("don't replace a dropped one with a new one");
  });
});

const logged = new Set(alexTurns.map((turn) => turn.hours_elapsed));

describe("checkDebrief: durations", () => {
  it.each([
    "From Hour 60 to Hour 72, 12 hours, the apartment stayed around 45 °F.",
    "The power was out from Hour 12 until Hour 60, two days later.",
    "Your refrigerator keeps food safe for about 4 hours without power (FDA guidance).",
    "Your stored water (1 gallon) and food (2 days) were below the recommended three‑day minimum (Baseline).",
    "Baseline recorded only 1 gallon of water, providing just 1 day of supply.",
    "Central heat came back several hours after you returned (Hour 72).",
  ])("allows an interval computed from logged hours, or no precise interval: %s", (sentence) => {
    expect(unsupportedInterval(sentence, logged)).toBeUndefined();
  });

  it.each([
    // The saved repair: power returned at Hour 60 and heat came back after Hour 72; the citation spans six hours.
    ["The central heating system took about six hours to restore after power returned (Hour 66–72 outcome).", "took about six hours"],
    ["Within about 10 minutes the circuit breaker tripped (Hour 72).", "Within about 10 minutes"],
    ["Power returned at Hour 60 and heat came back at Hour 72, six hours later.", "six hours later"],
  ])("rejects an interval the log's hours don't give: %s", (sentence, matched) => {
    expect(unsupportedInterval(sentence, logged)).toBe(matched);
  });

  it("flags the saved first draft's and repair's duration, with field and match", () => {
    for (const report of [saved.first, saved.repair] as AfterActionReport[]) {
      expect(checkDebrief(report, alex31Turns, alex31Context).filter((p) => p.check === "accuracy:unsupported-duration")).toEqual([
        expect.objectContaining({ field: "need_to_know[0]", fix: expect.stringContaining("leave the precise duration out") }),
      ]);
    }
  });
});

describe("omitKitImprovement: the server's fallback after a repair", () => {
  const repair = saved.repair as AfterActionReport;
  /** The saved repair with its duration and vague heating corrected: only the kit list is left. */
  const kitOnly: AfterActionReport = {
    ...repair,
    summary: repair.summary.replace("underscoring the need for additional warming methods", "so layers and blankets mattered"),
    need_to_know: [
      "Power returned at Hour 60, but the central heating stayed off through Hour 72, leaving indoor temperatures around 45 °F (Hours 60–72).",
      ...repair.need_to_know.slice(1),
    ],
  };
  const omit = (report: AfterActionReport) => omitKitImprovement(report, checkDebrief(report, alex31Turns, alex31Context), alex31Turns, alex31Context);

  it("doesn't apply to the saved repair: its wrong duration and vague heating must still prevent delivery", () => {
    expect(checkDebrief(repair, alex31Turns, alex31Context).map((p) => `${p.check} ${p.field}`)).toEqual([
      "list-shaped do_better[1].action",
      "safety:vague-heating summary",
      "accuracy:unsupported-duration need_to_know[0]",
    ]);
    expect(omit(repair)).toBeUndefined();
  });

  it("drops the whole kit improvement, evidence and reason too, and leaves the checklist as it is", () => {
    expect(checkDebrief(kitOnly, alex31Turns, alex31Context).map((p) => p.check)).toEqual(["list-shaped"]);
    const result = omit(kitOnly)!;
    expect(result.report.do_better).toEqual([repair.do_better[0], repair.do_better[2]]);
    expect(JSON.stringify(result.report.do_better)).not.toContain("Inventory check identified");
    expect(result.report.supply_checklist).toEqual(repair.supply_checklist);
    expect({ ...result.report, do_better: [] }).toEqual({ ...kitOnly, do_better: [] });
    expect(result.omitted).toEqual(repair.do_better[1]);
    expect(result.checks).toEqual(["list-shaped"]);
    expect(checkDebrief(result.report, alex31Turns, alex31Context)).toEqual([]);
  });

  it("drops a whole-kit action the same way", () => {
    const vague = { ...kitOnly, do_better: [kitOnly.do_better[0], { ...kitOnly.do_better[1], action: "Assemble a basic emergency kit." }] };
    expect(omit(vague)?.report.do_better).toEqual([kitOnly.do_better[0]]);
  });

  it("doesn't apply when no valid improvement would remain", () => {
    expect(omit({ ...kitOnly, do_better: [kitOnly.do_better[1]] })).toBeUndefined();
  });

  it("doesn't apply when kit lists are in two improvements", () => {
    expect(omit({ ...kitOnly, do_better: [kitOnly.do_better[0], kitOnly.do_better[1], { ...kitOnly.do_better[1], action: "Assemble a basic emergency kit." }] })).toBeUndefined();
  });

  it.each([
    ["an uncited point", { need_to_know: [...kitOnly.need_to_know, "Floods are dangerous."] }],
    ["the invented heater", { went_well: [...kitOnly.went_well, "You shut off the space heater when the breaker tripped (Hour 72)."] }],
    ["grid heat in an outage", { summary: `${kitOnly.summary} Keep a space heater for the next outage.` }],
    ["a kit list in another improvement's reason", { do_better: [{ ...kitOnly.do_better[0], why: kitOnly.do_better[1].action }, kitOnly.do_better[1], kitOnly.do_better[2]] }],
  ])("doesn't apply when another failure remains: %s", (_, change) => {
    const report = { ...kitOnly, ...change } as AfterActionReport;
    expect(checkDebrief(report, alex31Turns, alex31Context).some((p) => p.check === "list-shaped")).toBe(true);
    expect(omit(report)).toBeUndefined();
  });

  it("doesn't apply to a debrief that passed", () => {
    expect(omitKitImprovement(saved.repair as AfterActionReport, [], alex31Turns, alex31Context)).toBeUndefined();
  });
});

describe("checkDebrief: vague heating advice", () => {
  it.each([
    // The displayed 11:35 debrief, need_to_know[0].
    "Without power, the building’s central heating can remain below safe indoor temperatures (45 °F) for many hours; rely on layered clothing and non‑electrical heat sources (derived from Hours 66‑72).",
    "Keep an alternative heat source ready for the next outage.",
    "The outage underscored the need for additional warming methods.",
    "Have a backup heat source.",
    "Use non-electrical heat sources such as a camp stove or blankets.",
  ])("rejects a recommendation: %s", (sentence) => {
    expect(vagueHeating(sentence)).toBeDefined();
  });

  it.each([
    "Rely on layered clothing and blankets to stay warm.",
    "Keep alternative heat sources such as blankets and sleeping bags where you can reach them.",
    "Never use a grill, camp stove or other fuel-burning heat source indoors.",
    "Don't rely on alternative heat sources like propane heaters inside the apartment: they produce carbon monoxide.",
    "Alternative heat sources that burn fuel are dangerous indoors.",
    "Rely on layers and blankets rather than a backup heater.",
    "The limited water supply, lack of personal heat sources, and an incomplete emergency kit left you reliant on outside help.",
    "You used blankets as your only source of warmth (Hour 72).",
  ])("allows specific warmth, warnings and recounts: %s", (sentence) => {
    expect(vagueHeating(sentence)).toBeUndefined();
  });

  it("treats a checklist item as advice", () => {
    expect(vagueHeating("Alternative heat source", true)).toBeDefined();
    expect(vagueHeating("Warm sleeping bags or heavy blankets", true)).toBeUndefined();
  });

  it("rejects the displayed 11:35 debrief and the first draft on the same sentence, and nothing else new", () => {
    for (const report of [saved1135.first, saved1135.repair] as AfterActionReport[]) {
      expect(checkDebrief(report, alex31Turns, alex31Context).filter((p) => p.check === "safety:vague-heating")).toEqual([
        expect.objectContaining({ field: "need_to_know[0]", matched: "non‑electrical heat sources" }),
      ]);
    }
    expect(checkDebrief(saved1135.repair as AfterActionReport, alex31Turns, alex31Context).map((p) => p.check)).toEqual(["safety:vague-heating"]);
  });

  it("passes the displayed debrief once that sentence names the warmth", () => {
    const repair = saved1135.repair as AfterActionReport;
    const fixed = {
      ...repair,
      need_to_know: [
        "Central heating stayed off after power returned at Hour 60 and was still off through Hour 72, keeping the apartment around 45 °F; rely on layered clothing and blankets (Hours 60–72).",
        repair.need_to_know[1],
      ],
    };
    expect(checkDebrief(fixed, alex31Turns, alex31Context)).toEqual([]);
  });

  it("checks every displayed field", () => {
    const repair = saved1135.repair as AfterActionReport;
    const vague = "Keep an alternative heat source ready.";
    const report: AfterActionReport = {
      ...repair,
      summary: `${repair.summary} ${vague}`,
      went_well: [...repair.went_well, vague],
      do_better: [{ ...repair.do_better[0], why: vague }, repair.do_better[1]],
      supply_checklist: [...repair.supply_checklist, "Backup heat source"],
    };
    expect(checkDebrief(report, alex31Turns, alex31Context).filter((p) => p.check === "safety:vague-heating").map((p) => p.field)).toEqual(
      expect.arrayContaining(["summary", "went_well[4]", "do_better[0].why", "supply_checklist[14]"]),
    );
  });
});

describe("checkDebrief: electrical generalizations with can", () => {
  it("rejects the captured 11:35 sentence as a generalization", () => {
    const sentence = (saved1135.first as AfterActionReport).need_to_know[1];
    expect(sentence).toContain("can trip circuit breakers repeatedly");
    expect(electricalConclusion(sentence)).toEqual({ kind: "generalization", matched: "can trip" });
  });

  it.each([
    "Space heaters may overload an apartment circuit.",
    "Older wiring often trips under a heater's load.",
  ])("rejects other possibilities of tripping or overloading: %s", (sentence) => {
    expect(electricalConclusion(sentence)?.kind).toBe("generalization");
  });

  it.each([
    "Building maintenance can reset the breaker.",
    "You can shut off the main breaker if water reaches the outlets (Hour 30).",
    "You can trip the main breaker to cut power to flooded outlets.",
    "Electric heat can't run without power, so outlets are useless during the outage.",
    "The breaker tripped and the lights went out (Hour 72).",
  ])("allows other sentences with can: %s", (sentence) => {
    expect(electricalConclusion(sentence)).toBeUndefined();
  });
});

describe("checkDebrief: Alex's 11:42 drafts", () => {
  const repair = saved1142.repair as AfterActionReport;
  const problems = checkDebrief(repair, alex31Turns, alex31Context);

  it("accepts citations written with a no-break space after Hour", () => {
    expect(repair.need_to_know[0]).toContain("Hour 0");
    expect(problems.filter((p) => p.check === "uncited")).toEqual([]);
    expect(checkDebrief(saved1142.first as AfterActionReport, alex31Turns, alex31Context).filter((p) => p.check === "uncited").map((p) => p.field)).toEqual([]);
  });

  it("rejects the repair on the whole-kit action and the vague warmth in its summary", () => {
    expect(problems.map((p) => `${p.check} ${p.field} ${p.matched}`)).toEqual([
      "vague-kit do_better[1].action kit",
      "safety:vague-heating summary alternative warmth strategies",
    ]);
  });

  it("isn't delivered by the fallback, because the vague warmth remains", () => {
    expect(omitKitImprovement(repair, problems, alex31Turns, alex31Context)).toBeUndefined();
  });

  it("would be delivered with the kit improvement omitted if the summary named the warmth", () => {
    const named = {
      ...repair,
      summary: repair.summary.replace("the importance of alternative warmth strategies", "the importance of layers and blankets"),
    };
    const result = omitKitImprovement(named, checkDebrief(named, alex31Turns, alex31Context), alex31Turns, alex31Context);
    expect(result?.report.do_better).toEqual([repair.do_better[0]]);
  });

  it("still rejects a hour that never happened when written with a no-break space", () => {
    const report = { ...repair, need_to_know: ["The water reached the outlets (Hour 31)."] };
    expect(checkDebrief(report, alex31Turns, alex31Context).map((p) => p.check)).toContain("hour-not-in-log");
  });
});
