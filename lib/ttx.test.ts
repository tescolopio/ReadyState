import { describe, expect, it } from "vitest";

import {
  DEBRIEF_REQUEST,
  RECENT_LOG_TURNS,
  buildExercisePrompt,
  deriveTtxState,
  participantResponses,
  type AfterActionReport,
  type TtxUIMessage,
  type TurnOutput,
} from "@/lib/ttx";

const turn = (overrides: Partial<TurnOutput> = {}): TurnOutput => ({
  feedback: null,
  narrative_response: "A winter storm knocks out power.",
  time_elapsed: "Hour 0",
  hours_elapsed: 0,
  new_inject: "Pipes begin to freeze.",
  critical_alerts: [],
  suggested_actions: [],
  response_options: [],
  scenario_status: "ongoing",
  ...overrides,
});

const user = (id: string, text: string): TtxUIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});

const turnMessage = (id: string, output: TurnOutput): TtxUIMessage => ({
  id,
  role: "assistant",
  parts: [
    {
      type: "tool-generate_turn",
      toolCallId: `call-${id}`,
      state: "output-available",
      input: output,
      output,
    },
  ],
});

const report: AfterActionReport = {
  summary: "Water storage carried the household; heat was the weak point.",
  went_well: ["Water storage"],
  need_to_know: ["The furnace needs power to run"],
  do_better: [{ action: "Plan a safe backup heat source", evidence: "Hour 12: the cold house", why: "The furnace needs power." }],
  supply_checklist: [],
};

describe("deriveTtxState", () => {
  it("starts in the baseline phase", () => {
    expect(deriveTtxState([])).toMatchObject({ phase: "baseline", hoursElapsed: 0 });
    expect(deriveTtxState([user("u1", "[Adult 1], [Large Dog]")]).phase).toBe(
      "baseline",
    );
  });

  it("enters the action/inject loop after the inciting incident", () => {
    const state = deriveTtxState([user("u1", "params"), turnMessage("a1", turn())]);
    expect(state.phase).toBe("loop");
    expect(state.turns).toHaveLength(1);
  });

  it("ignores tool calls that are still streaming", () => {
    const streaming: TtxUIMessage = {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-generate_turn",
          toolCallId: "c1",
          state: "input-streaming",
          input: { narrative_response: "A winter" },
        },
      ],
    };
    expect(deriveTtxState([user("u1", "params"), streaming]).phase).toBe("baseline");
  });

  it("keeps going after a setback: there is no fail state", () => {
    const state = deriveTtxState([
      turnMessage("a1", turn()),
      turnMessage("a2", turn({ hours_elapsed: 24, critical_alerts: ["Insulin above 8 °C"] })),
    ]);
    expect(state).toMatchObject({ phase: "loop", hoursElapsed: 24 });
  });

  it("ends once the exercise reaches its full length", () => {
    expect(
      deriveTtxState([turnMessage("a1", turn({ hours_elapsed: 72, time_elapsed: "Hour 72" }))]).phase,
    ).toBe("ended");
    expect(deriveTtxState([turnMessage("a1", turn({ scenario_status: "complete" }))]).phase).toBe(
      "ended",
    );
  });

  it("moves to the AAR phase once the report is generated", () => {
    const state = deriveTtxState([
      turnMessage("a1", turn({ scenario_status: "complete", hours_elapsed: 72 })),
      user("u2", "Generate the AAR"),
      {
        id: "a2",
        role: "assistant",
        parts: [
          {
            type: "tool-after_action_report",
            toolCallId: "c2",
            state: "output-available",
            input: report,
            output: report,
          },
        ],
      },
    ]);
    expect(state.phase).toBe("aar");
    expect(state.report).toEqual(report);
  });
});

describe("buildExercisePrompt", () => {
  it("sends only the baseline before the first turn", () => {
    const prompt = buildExercisePrompt([user("u1", "[Adult 1], [Large Dog]")]);
    expect(prompt).toBe("HOUSEHOLD BASELINE (sanitized):\n[Adult 1], [Large Dog]");
  });

  it("condenses older turns and keeps the latest turn in full", () => {
    const prompt = buildExercisePrompt([
      user("u1", "params"),
      turnMessage("a1", turn({ narrative_response: "Old narrative.", new_inject: "Pipes freeze." })),
      user("u2", "Drip the faucets."),
      turnMessage(
        "a2",
        turn({
          narrative_response: "Latest narrative.",
          time_elapsed: "Hour 8",
          hours_elapsed: 8,
          new_inject: "Roads close.",
          critical_alerts: ["Heat offline"],
        }),
      ),
      user("u3", "Seal one room."),
    ]);

    expect(prompt).not.toContain("Old narrative.");
    expect(prompt).toContain("- Hour 0: Inject: Pipes freeze. | Alerts: none");
    expect(prompt).toContain(
      [
        "LATEST TURN (Hour 8, hours_elapsed 8):",
        "Participant action: Drip the faucets.",
        "Outcome: Latest narrative.",
        "Inject: Roads close.",
        "Critical alerts: Heat offline",
      ].join("\n"),
    );
    expect(prompt.endsWith("PARTICIPANT ACTION:\nSeal one room.")).toBe(true);
  });

  it("grows by one log line per turn instead of a full transcript", () => {
    const messages: TtxUIMessage[] = [user("u0", "params")];
    const lengths: number[] = [];
    for (let i = 1; i <= 10; i++) {
      messages.push(
        turnMessage(`a${i}`, turn({ narrative_response: "N".repeat(800), hours_elapsed: i * 6 })),
        user(`u${i}`, "Do the next thing."),
      );
      lengths.push(buildExercisePrompt(messages).length);
    }
    const growth = lengths.at(-1)! - lengths[1];
    expect(growth / 8).toBeLessThan(150);
  });

  it(`shrinks turns older than the last ${RECENT_LOG_TURNS} to the action and the inject's first sentence`, () => {
    const messages: TtxUIMessage[] = [user("u0", "params")];
    for (let i = 1; i <= RECENT_LOG_TURNS + 3; i++) {
      messages.push(
        turnMessage(
          `a${i}`,
          turn({
            time_elapsed: `Hour ${i * 6}`,
            hours_elapsed: i * 6,
            new_inject: `Inject ${i} happens. More detail about inject ${i}.`,
            critical_alerts: [`Alert ${i}`],
          }),
        ),
        user(`u${i}`, `Action ${i}.`),
      );
    }
    const prompt = buildExercisePrompt(messages);

    expect(prompt).toContain("- Hour 6: Inject: Inject 1 happens.\n");
    expect(prompt).toContain("- Hour 12: Participant: Action 1. | Inject: Inject 2 happens.\n");
    expect(prompt).not.toContain("Alert 1");
    // The last few earlier turns stay in full.
    expect(prompt).toContain("- Hour 18: Participant: Action 2. | Inject: Inject 3 happens. More detail about inject 3. | Alerts: Alert 3");
  });

  it("keeps a 20-turn briefing small", () => {
    const messages: TtxUIMessage[] = [user("u0", "B".repeat(1500))];
    for (let i = 1; i <= 20; i++) {
      messages.push(
        turnMessage(
          `a${i}`,
          turn({
            narrative_response: "N".repeat(900),
            new_inject: `${"I".repeat(150)}. ${"J".repeat(300)}.`,
            critical_alerts: ["A".repeat(60), "A".repeat(60)],
            hours_elapsed: i * 4,
          }),
        ),
        user(`u${i}`, "D".repeat(250)),
      );
    }
    // About 4 characters per token: under 3,000 tokens. With the system
    // prompt, safety rules and tool schema (about 1,700), a request stays
    // within G6's 5,000-token target.
    expect(buildExercisePrompt(messages).length).toBeLessThan(12_000);
  });
});

describe("participantResponses", () => {
  it("pairs each response with the turn before it, even after a resend, and skips the debrief request", () => {
    const messages = [
      user("u0", "baseline"),
      turnMessage("a0", turn()),
      user("u1", "first try"),
      // The next turn failed; the participant sent the response again.
      user("u2", "resent"),
      turnMessage("a1", turn({ time_elapsed: "Hour 6", hours_elapsed: 6 })),
      user("u3", "after hour 6"),
      turnMessage("a2", turn({ time_elapsed: "Hour 12", hours_elapsed: 12, scenario_status: "complete" })),
      user("u4", DEBRIEF_REQUEST),
    ];
    expect(participantResponses(messages)).toEqual({ baseline: "baseline", responses: ["resent", "after hour 6", ""] });
  });
});
