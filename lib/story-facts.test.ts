import { describe, expect, it } from "vitest";

import { storyFacts, storyFactsBriefing } from "@/lib/story-facts";
import type { TurnOutput } from "@/lib/ttx";

const turn = (hours: number, new_inject = "", narrative_response = ""): TurnOutput => ({
  feedback: null,
  narrative_response,
  time_elapsed: `Hour ${hours}`,
  hours_elapsed: hours,
  new_inject,
  critical_alerts: [],
  suggested_actions: [],
  response_options: [],
  scenario_status: "ongoing",
});

describe("storyFacts", () => {
  it("leaves out power and heating when the story never says power came back", () => {
    const note = storyFactsBriefing(
      storyFacts([
        turn(0, "The power goes out."),
        turn(6, "You could wait until power returns."),
        // Priya, Hour 12 (2026-10-28): a goal, not an event.
        turn(12, "You must decide how to protect Person 3, restore power to the medical device, and avoid a dead car battery."),
      ]),
    );
    expect(note).not.toContain("Power returned");
    expect(note).not.toContain("Heating after power returned");
    expect(note).toContain("Logged hours: Hour 0, Hour 6, Hour 12.");
    expect(note).toContain("The participant's actions are only what their own responses say.");
  });

  it("classifies heating from the hour power returned as observed, forecast or confirmed", () => {
    const facts = storyFacts([
      turn(0, "The heating is offline."),
      turn(6, "Power is restored, but the furnace is still off."),
      turn(12, "Maintenance says the heat should be back by tomorrow."),
      turn(18, "", "The furnace comes back on."),
    ]);
    expect(facts.powerReturned).toEqual({ hour: 6, sentence: "Power is restored, but the furnace is still off." });
    expect(facts.heatingAfterPower.map(({ hour, state }) => `${hour} ${state}`)).toEqual(["6 unavailable", "12 forecast", "18 restored"]);
    expect(storyFactsBriefing(facts)).toContain("until it returned during the Hour 18 turn");
  });

  it("says heating was still unavailable at the last report when no restoration is confirmed", () => {
    const note = storyFactsBriefing(
      storyFacts([turn(0, "Power comes back on, but the central heating is slow to recover."), turn(6, "The heating system will be restored in about four hours.")]),
    );
    expect(note).toContain("Hour 6, forecast only, not an event");
    expect(note).toContain("So heating was still unavailable at Hour 0, the last report, after power returned at Hour 0.");
    expect(note).not.toContain("returned during");
  });
});

describe("storyFacts order within a turn", () => {
  it("takes the turn's outcome before its new inject", () => {
    const facts = storyFacts([
      turn(0, "The power goes out."),
      turn(60, "The building says power is restored at noon tomorrow.", "Power is restored, but the central heating stays off."),
    ]);
    expect(facts.powerReturned).toEqual({ hour: 60, sentence: "Power is restored, but the central heating stays off." });
  });
});
