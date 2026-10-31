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
    const note = storyFactsBriefing(storyFacts([turn(0, "The power goes out."), turn(6, "You could wait until power returns.")]));
    expect(note).not.toContain("Power returned");
    expect(note).not.toContain("Heating after power returned");
    expect(note).toContain("Logged hours: Hour 0, Hour 6.");
    expect(note).toContain("The participant's actions are only what their own responses say.");
  });

  it("lists what the story says about heating from the hour power returned", () => {
    const facts = storyFacts([
      turn(0, "The heating is offline."),
      turn(6, "Power is restored, but the furnace is still off."),
      turn(12, "", "The heat comes back on."),
    ]);
    expect(facts.powerReturned).toEqual({ hour: 6, sentence: "Power is restored, but the furnace is still off." });
    expect(facts.heatingAfterPower.map(({ hour }) => hour)).toEqual([6, 12]);
  });
});
