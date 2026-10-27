import { describe, expect, it } from "vitest";

import {
  deriveTtxState,
  type AfterActionReport,
  type TtxUIMessage,
  type TurnOutput,
} from "@/lib/ttx";

const turn = (overrides: Partial<TurnOutput> = {}): TurnOutput => ({
  narrative_response: "A winter storm knocks out power.",
  time_elapsed: "Hour 0",
  hours_elapsed: 0,
  new_inject: "Pipes begin to freeze.",
  critical_alerts: [],
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
  overall_grade: "B",
  score: 82,
  outcome: "survived",
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

  it("ends when a critical constraint fails", () => {
    const state = deriveTtxState([
      turnMessage("a1", turn()),
      turnMessage("a2", turn({ hours_elapsed: 24, scenario_status: "failed" })),
    ]);
    expect(state).toMatchObject({ phase: "ended", outcome: "failed", hoursElapsed: 24 });
  });

  it("ends as survived once the target duration is reached", () => {
    const state = deriveTtxState([
      turnMessage("a1", turn({ hours_elapsed: 72, time_elapsed: "Hour 72" })),
    ]);
    expect(state).toMatchObject({ phase: "ended", outcome: "survived" });
  });

  it("moves to the AAR phase once the report is generated", () => {
    const state = deriveTtxState([
      turnMessage("a1", turn({ scenario_status: "survived", hours_elapsed: 72 })),
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
