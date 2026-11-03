import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import * as contracts from "@/lib/exercise-contracts";
import { buildExerciseBriefing, EXERCISE_CONTEXT_VERSION, type ExerciseExchange } from "@/lib/exercise-context";
import { prepareDebriefContext } from "@/lib/exercise-debrief";
import { exercisePrompt, EXERCISE_PROMPT_VERSION } from "@/lib/exercise-prompts";
import { checkDebrief, storyDefects } from "@/lib/debrief-checks";
import { leakedTerms, privateTerms } from "@/lib/household";
import { engineBaseline } from "@/lib/inventory";
import { SAFETY_RULES } from "@/lib/rules";
import { storyFacts, storyFactsBriefing } from "@/lib/story-facts";
import { TEST_HOUSEHOLDS } from "@/lib/test-households";
import * as api from "@/lib/ttx";
import { usePrivacyStore } from "@/store/usePrivacyStore";
import { maskInput } from "@/utils/obfuscator";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const turn = (hour: number): contracts.TurnOutput => ({
  feedback: null, narrative_response: `Outcome at ${hour}.`, hours_elapsed: hour,
  time_elapsed: `Hour ${hour}`, new_inject: `Inject ${hour}. Further detail ${hour}.`,
  critical_alerts: [`Alert ${hour}`], suggested_actions: [], response_options: [],
  scenario_status: hour === 72 ? "complete" : "ongoing",
});
const user = (id: string, text: string): api.TtxUIMessage => ({
  id, role: "user", parts: [{ type: "text", text }],
});
const assistant = (id: string, output: contracts.TurnOutput): api.TtxUIMessage => ({
  id, role: "assistant", parts: [{
    type: "tool-generate_turn", toolCallId: id, state: "output-available", input: output, output,
  }],
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Shared exercise foundation must not call a provider"); }));
  usePrivacyStore.getState().clearMappings();
});
afterEach(() => vi.unstubAllGlobals());

describe("provider-independent exercise foundation", () => {
  // Generated from pre-extraction main 0a5ef43, not from the extracted modules.
  it.each([
    ["baseline", "c2d91e715e022de425e2f36b84fbcc6d0bee65a472d280a94332ffe5bd6c9672"],
    ["loop", "3f5ad40f013ac6415175c4decf92acec0dea453d28868f8e12698b4098e9464d"],
    ["ended", "12879537ef1661fa22375a869851b7eb58117f0e33d81036e74b10a4d459c4e3"],
  ] as const)("preserves the exact existing %s API instructions", (phase, expected) => {
    const prompt = exercisePrompt(phase);
    const instructions = `${prompt.system}\n- Never reply with plain text. Always respond by calling the required tool.\n\n${prompt.phase}`;
    expect(hash(instructions)).toBe(expected);
    expect(prompt.system).not.toContain("Always respond by calling");
    for (const rule of SAFETY_RULES) expect(prompt.system).toContain(rule.prompt);
  });

  it.each([
    ["feedbackSchema", "75c25a82a441011f431f9438c464300b04adb456ea68222ce3b95b3c2912f907"],
    ["turnSchema", "6332b69e21f18601b6dc1526bdb2a01cef7ef90f3def32d0557c9bc6646dd7ad"],
    ["afterActionReportSchema", "7c5f5f03c51d3b535b082337a96cf93a888220eda4793a2a29a191c8cc15afcd"],
  ] as const)("preserves %s shape, descriptions and public re-export", (name, expected) => {
    expect(hash(JSON.stringify(z.toJSONSchema(contracts[name])))).toBe(expected);
    expect(api[name]).toBe(contracts[name]);
  });

  it("versions schemas, prompts and context independently of provider transport", () => {
    expect(contracts.EXERCISE_SCHEMA_VERSION).toBe("1");
    expect(EXERCISE_PROMPT_VERSION).toBe("1");
    expect(EXERCISE_CONTEXT_VERSION).toBe("1");
    expect(contracts.TARGET_DURATION_HOURS).toBe(72);
    expect(contracts.turnSchema.safeParse({ ...turn(0), hours_elapsed: Infinity }).success).toBe(false);
    expect(contracts.turnSchema.safeParse({ ...turn(0), hours_elapsed: NaN }).success).toBe(false);
  });

  it.each(TEST_HOUSEHOLDS)("$id keeps masked context identical across domain and API adapters", ({ profile }) => {
    const baseline = engineBaseline(profile, text => maskInput(text, { alwaysMask: privateTerms(profile), dryRun: true }));
    const exchanges: ExerciseExchange[] = [0, 12, 24, 36, 48, 60, 72].map((hour, index) => ({
      ...(index ? { action: `Approved response ${index}.` } : {}), turn: turn(hour),
    }));
    const messages: api.TtxUIMessage[] = [user("baseline", baseline)];
    for (const [index, exchange] of exchanges.entries()) {
      if (exchange.action) messages.push(user(`response-${index}`, exchange.action));
      messages.push(assistant(`turn-${index}`, exchange.turn));
    }
    messages.push(user("request", api.DEBRIEF_REQUEST));
    const before = structuredClone(exchanges);
    const context = { baseline, exchanges, pendingAction: api.DEBRIEF_REQUEST };
    const briefing = buildExerciseBriefing(context);
    expect(briefing).toBe(api.buildExercisePrompt(messages));
    expect(leakedTerms(briefing, privateTerms(profile))).toEqual([]);
    expect(briefing).toContain("- Hour 0: Inject: Inject 0.");
    expect(briefing).not.toContain("Further detail 0.");
    expect(briefing).not.toContain("Further detail 12.");
    expect(briefing).toContain("Further detail 24.");
    expect(briefing).toContain("LATEST TURN (Hour 72, hours_elapsed 72)");
    expect(exchanges).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not imply masking or approval when formatting unreviewed text", () => {
    const raw = "Synthetic private text not yet approved";
    expect(buildExerciseBriefing({ baseline: raw, exchanges: [] })).toContain(raw);
    expect(buildExerciseBriefing({ exchanges: [] })).toBe("HOUSEHOLD BASELINE (sanitized):\n(not provided)");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shares the exact debrief evidence and check context without generating a model response", () => {
    const baseline = "A household with no generator. Power is out.";
    const turns = [turn(0), {
      ...turn(72), narrative_response: "Power is restored. The heating is still offline.",
    }];
    const participantText = ["I put on warm clothing.", ""];
    const before = structuredClone({ turns, participantText });
    const briefing = buildExerciseBriefing({ baseline, exchanges: turns.map(value => ({ turn: value })) });
    const result = prepareDebriefContext({ turns, baseline, participantText, briefing });
    const defects = storyDefects(turns, { baseline, participantText });
    expect(result.context).toEqual({ baseline, participantText, defects });
    expect(result.briefing).toBe(`${briefing}\n\n${storyFactsBriefing(storyFacts(turns, defects))}`);
    const report: contracts.AfterActionReport = {
      summary: "Synthetic rejected advice.", went_well: [], need_to_know: [],
      do_better: [{ action: "Use a charcoal grill indoors.", evidence: "Hour 0", why: "Cook inside." }],
      supply_checklist: [],
    };
    expect(checkDebrief(report, turns, result.context)).toEqual(checkDebrief(report, turns, { baseline, participantText, defects }));
    expect(checkDebrief(report, turns, result.context).some(problem => problem.category === "safety")).toBe(true);
    expect({ turns, participantText }).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  });
});
