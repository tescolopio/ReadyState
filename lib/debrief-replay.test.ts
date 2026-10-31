/**
 * Every captured Alex debrief draft, replayed through the checks and the
 * server's fallback with the real baseline and turns. Each expected failure
 * was confirmed in the manual reviews in docs/testing/eval-2026-10-28.md, so
 * a new failure here is a false positive until a reading shows otherwise.
 * `knownMisses` are defects the reviews found that no check covers; they are
 * the reason manual review stays the accuracy gate (G11).
 *
 * The variations reword each defect without changing its meaning, so the
 * checks are shown to cover the defect and not only the captured phrase.
 */
import { describe, expect, it } from "vitest";

import { checkDebrief, electricalConclusion, omitKitImprovement, storyDefects, unsupportedInterval } from "@/lib/debrief-checks";
import d0407 from "@/lib/fixtures/alex-2026-10-31-0407-drafts.json";
import d1135 from "@/lib/fixtures/alex-2026-10-31-1135-drafts.json";
import d1142 from "@/lib/fixtures/alex-2026-10-31-1142-drafts.json";
import replay from "@/lib/fixtures/alex-replay-turns.json";
import { engineBaseline } from "@/lib/inventory";
import { storyFacts, storyFactsBriefing } from "@/lib/story-facts";
import { TEST_HOUSEHOLDS } from "@/lib/test-households";
import type { AfterActionReport, TurnOutput } from "@/lib/ttx";

const turns = replay.turns as TurnOutput[];
const baseline = engineBaseline(TEST_HOUSEHOLDS.find((household) => household.id === "alex")!.profile);
const context = { baseline, participantText: replay.responses };
const failures = (report: AfterActionReport) => checkDebrief(report, turns, context).map((p) => `${p.check} ${p.field}`);

/** What the server would do with a repair: show it, show it with one improvement omitted, or withhold it. */
function outcome(report: AfterActionReport) {
  const problems = checkDebrief(report, turns, context);
  if (!problems.length) return "displayed";
  return omitKitImprovement(report, problems, turns, context) ? "displayed with an improvement omitted" : "withheld";
}

interface Captured {
  name: string;
  report: AfterActionReport;
  expected: string[];
  knownMisses: string[];
  /** For a repair: what the server would do with it. */
  outcome?: ReturnType<typeof outcome>;
}

const CAPTURED: Captured[] = [
  {
    name: "04:07 first draft",
    report: d0407.first as AfterActionReport,
    expected: [
      "list-shaped do_better[1].action",
      "invented-premise summary",
      "invented-premise need_to_know[1]",
      "invented-premise went_well[2]",
      "invented-premise do_better[2].why",
      "outage-grid-heat summary",
      "accuracy:unsupported-electrical-conclusion summary",
      "accuracy:unsupported-duration need_to_know[0]",
      "accuracy:unsupported-electrical-conclusion need_to_know[1]",
      "accuracy:unsupported-electrical-conclusion do_better[2].why",
      "accuracy:unsupported-electrical-conclusion went_well[2]",
    ],
    knownMisses: ["do_better[2].why ties CO detection to electric heaters (the sentence fails on the invented heater)"],
  },
  {
    name: "04:07 repair",
    report: d0407.repair as AfterActionReport,
    expected: ["list-shaped do_better[1].action", "safety:vague-heating summary", "accuracy:unsupported-duration need_to_know[0]"],
    knownMisses: [],
    outcome: "withheld",
  },
  {
    name: "11:35 first draft",
    report: d1135.first as AfterActionReport,
    expected: [
      "list-shaped do_better[2].action",
      "invented-premise need_to_know[1]",
      "safety:vague-heating need_to_know[0]",
      "accuracy:unsupported-electrical-conclusion need_to_know[1]",
    ],
    knownMisses: [],
  },
  {
    name: "11:35 repair (displayed at the time)",
    report: d1135.repair as AfterActionReport,
    expected: ["safety:vague-heating need_to_know[0]"],
    knownMisses: ['need_to_know[0] attributes the cold to "without power", though heating stayed off after power returned (finding 32)'],
    outcome: "withheld",
  },
  {
    name: "11:42 first draft",
    report: d1142.first as AfterActionReport,
    expected: [
      "list-shaped do_better[1].action",
      "list-shaped do_better[2].action",
      "invented-premise summary",
      "invented-premise need_to_know[1]",
      "invented-premise do_better[2].evidence",
      "safety:vague-heating need_to_know[0]",
      "accuracy:unsupported-electrical-conclusion need_to_know[1]",
      "accuracy:unsupported-electrical-conclusion do_better[2].why",
      "accuracy:purchase-on-trip do_better[2].action",
    ],
    knownMisses: ['summary credits the participant with "coordinated with building staff to restore power"'],
  },
  {
    name: "11:42 repair",
    report: d1142.repair as AfterActionReport,
    expected: ["vague-kit do_better[1].action", "safety:vague-heating summary"],
    knownMisses: [],
    outcome: "withheld",
  },
];

describe("replaying the captured drafts", () => {
  it.each(CAPTURED.map((captured) => [captured.name, captured] as const))("%s fails exactly the checks manual review confirmed", (_, captured) => {
    expect(failures(captured.report)).toEqual(captured.expected);
  });

  it.each(CAPTURED.filter((captured) => captured.outcome).map((captured) => [captured.name, captured] as const))(
    "%s: the server's decision",
    (_, captured) => {
      expect(outcome(captured.report)).toBe(captured.outcome);
    },
  );

  it("displays no draft with a defect manual review found", () => {
    for (const captured of CAPTURED.filter((c) => c.outcome)) {
      if (outcome(captured.report) !== "withheld") expect([...captured.expected, ...captured.knownMisses]).toEqual([]);
    }
  });

  it("cites the inventory only where a supplied finding matches", () => {
    // The 11:42 repair's "(from inventory check)" is about the missing kit, a supplied finding.
    expect(failures(d1142.repair as AfterActionReport).filter((f) => f.startsWith("inventory") || f.startsWith("uncited"))).toEqual([]);
  });
});

/** The displayed 11:35 repair, with one sentence replaced. */
const withFact = (text: string): AfterActionReport => {
  const repair = d1135.repair as AfterActionReport;
  return { ...repair, need_to_know: [text, repair.need_to_know[1]] };
};
const checksOn = (report: AfterActionReport, field: string) =>
  checkDebrief(report, turns, context)
    .filter((p) => p.field === field)
    .map((p) => p.check);

describe("meaning-preserving variations of the captured defects", () => {
  it.each([
    "Rely on layered clothing and non‑electric heating options when the heat is off (Hours 60–72).",
    "Keep an alternate heat source on hand for outages (Hour 60).",
    "Plan for other ways to heat the apartment when the building's heat is out (Hours 60–72).",
    "Use a heat source that doesn't need electricity while the central heating is down (Hour 72).",
    "The cold apartment showed the importance of backup heating (Hours 60–72).",
    "Rely on heat that works without power until the building's heat returns (Hour 66).",
  ])("vague heating still fails: %s", (sentence) => {
    expect(checksOn(withFact(sentence), "need_to_know[0]")).toContain("safety:vague-heating");
  });

  it.each([
    "Central heating stayed off after power returned at Hour 60 and was still off at Hour 72; rely on layered clothing, blankets and a sleeping bag (Hours 60–72).",
    "Keep non-electric warmth such as blankets and layers where you can reach them (Hours 60–72).",
    "Never heat the apartment with a gas oven or another fuel-burning heat source (CDC guidance).",
    "Backup heat sources that burn fuel produce carbon monoxide indoors (CDC guidance).",
    "You had no backup heat source when the building's heat failed (Hour 60).",
  ])("specific warmth, warnings and recounts pass: %s", (sentence) => {
    expect(checksOn(withFact(sentence), "need_to_know[0]")).toEqual([]);
  });

  it.each([
    "Space heaters could overload older wiring.",
    "Heaters tend to trip breakers in older buildings.",
    "A 1,500 W heater is likely to trip the breaker.",
    "Older apartment circuits are prone to tripping under a heater's load.",
  ])("electrical generalizations still fail: %s", (sentence) => {
    expect(electricalConclusion(sentence)?.kind).toBe("generalization");
  });

  it.each([
    "Maintenance reset the breaker after it tripped (Hour 72).",
    "You can reset a tripped breaker by switching it fully off and back on.",
    "You can shut off the main breaker if water reaches the outlets.",
  ])("other electrical sentences pass: %s", (sentence) => {
    expect(electricalConclusion(sentence)).toBeUndefined();
  });

  const hours = new Set(turns.map((turn) => turn.hours_elapsed));
  it.each([
    "Heat came back six hours after the power did (Hour 60).",
    "It took roughly 6 hours for the heat to return after power was restored (Hours 66–72).",
    "Heat returned 12 hours after Hour 60.",
  ])("unsupported intervals still fail: %s", (sentence) => {
    expect(unsupportedInterval(sentence, hours)).toBeDefined();
  });

  it.each(["From Hour 60 to Hour 72, 12 hours, the heat stayed off.", "Central heating came back a few hours after Hour 72."])(
    "supported or imprecise intervals pass: %s",
    (sentence) => {
      expect(unsupportedInterval(sentence, hours)).toBeUndefined();
    },
  );

  it.each([
    ["Build a go-bag with a radio, a first-aid kit, batteries and a whistle.", "list-shaped"],
    ["Put together an emergency supply kit.", "vague-kit"],
    ["Get your preparedness supplies together.", "vague-kit"],
  ])("kit improvements still fail: %s", (action, check) => {
    const repair = d1135.repair as AfterActionReport;
    const report = { ...repair, do_better: [repair.do_better[0], { ...repair.do_better[1], action }] };
    expect(checksOn(report, "do_better[1].action")).toContain(check);
  });

  it.each([
    "Relying on the space heater could have led to a fire (Hour 72).",
    "You had to use the space heater because the heat was off (Hour 72).",
  ])("a recounted heater isn't a grid-heat recommendation (finding 35), but still an invented premise: %s", (sentence) => {
    expect(checksOn(withFact(sentence), "need_to_know[0]")).toEqual(["invented-premise"]);
  });

  it("a recommended heater fails as grid heat in an outage", () => {
    expect(checksOn(withFact("Keep a low-wattage space heater for the next outage (Hour 72)."), "need_to_know[0]")).toContain("outage-grid-heat");
  });

  it.each([
    ["You have no generator for outages (inventory check).", ["inventory-unmatched"]],
    ["You have no battery radio for alerts (inventory gaps).", []],
    ["Your stored water covers only about a day (inventory findings).", []],
  ])("inventory citations need a matching finding: %s", (sentence, expected) => {
    expect(checksOn(withFact(sentence), "need_to_know[0]")).toEqual(expected);
  });
});

describe("the story-facts note for Alex's replay", () => {
  const note = storyFactsBriefing(storyFacts(turns, storyDefects(turns, context)));

  it("has power returning at Hour 60, not at the Hour 42 hypothetical", () => {
    expect(note).toContain("Power returned at Hour 60");
    expect(note).not.toContain("Hour 42:");
  });

  it("keeps heating unavailable after power returned, until it comes back in the Hour 72 turn", () => {
    expect(note).toContain("Hour 60: \"Power is restored but the building’s central heating is slow to recover");
    expect(note).toContain("Hour 72: \"With the central heating still offline");
    expect(note).toContain("comes back online");
  });

  it("names the invented heater, the logged hours, and that only the participant's responses are their actions", () => {
    expect(note).toContain("The space heater, first at Hour 60");
    expect(note).toContain("Logged hours: Hour 0, Hour 6");
    expect(note).toContain("such as coordinating with building staff or restoring power");
  });

  it("stays compact", () => {
    expect(note.length).toBeLessThan(1600);
  });
});

describe("citations written with a no-break space after Hour (finding 33)", () => {
  it("are accepted, and an hour that never happened still fails", () => {
    const repair = d1142.repair as AfterActionReport;
    expect(repair.need_to_know[0]).toContain("Hour 0");
    expect(checksOn({ ...repair, need_to_know: ["The water reached the outlets (Hour 31)."] }, "need_to_know[0]")).toEqual(["hour-not-in-log"]);
  });
});
