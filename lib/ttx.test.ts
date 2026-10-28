import { describe, expect, it } from "vitest";

import {
  buildExercisePrompt,
  deriveTtxState,
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
  summary: "Solid response.",
  strengths: ["Water storage"],
  supply_gaps: ["Generator"],
  recommendations: ["Buy a generator"],
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
});
