// @ts-check
import { z } from "zod";

export const DIAGNOSTIC_BASELINE = "ReadyState connection diagnostic v1. This is a fixed fictional transport fixture, not a household or emergency scenario. Return only the specified diagnostic acknowledgement.";
export const diagnosticTurn = {
  feedback: null,
  narrative_response: "ReadyState diagnostic acknowledgement received.",
  hours_elapsed: 0,
  time_elapsed: "Hour 0",
  new_inject: "Connection diagnostic only; no emergency guidance was generated.",
  critical_alerts: [],
  suggested_actions: [],
  response_options: ["Diagnostic complete.", "Inspect the saved result.", "Disconnect the test connection."],
  scenario_status: "ongoing",
};

export const diagnosticTurnSchema = z.object({
  feedback: z.null(),
  narrative_response: z.literal(diagnosticTurn.narrative_response),
  hours_elapsed: z.literal(0),
  time_elapsed: z.literal("Hour 0"),
  new_inject: z.literal(diagnosticTurn.new_inject),
  critical_alerts: z.array(z.never()).length(0),
  suggested_actions: z.array(z.never()).length(0),
  response_options: z.tuple([
    z.literal(diagnosticTurn.response_options[0]),
    z.literal(diagnosticTurn.response_options[1]),
    z.literal(diagnosticTurn.response_options[2]),
  ]),
  scenario_status: z.literal("ongoing"),
}).strict();

export const diagnosticStateSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  phase: z.literal("baseline").or(z.literal("loop")),
  baseline: z.object({ id: z.string().uuid(), text: z.literal(DIAGNOSTIC_BASELINE) }),
  events: z.array(z.object({ id: z.string().uuid(), turn: diagnosticTurnSchema })).max(1),
  pendingResponse: z.never().optional(),
  shortStepReason: z.never().optional(),
}).refine(state => state.phase === (state.events.length === 0 ? "baseline" : "loop"));

export const diagnosticSubmissionSchema = z.object({
  taskId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  candidate: diagnosticTurnSchema,
}).strict();

export const diagnosticReceiptSchema = z.object({
  sessionId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
});
