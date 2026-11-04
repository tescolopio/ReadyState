// @ts-check
import { z } from "zod";

export const DIAGNOSTIC_BASELINE = "ReadyState connection diagnostic v1. This is a fixed fictional transport fixture, not a household or emergency scenario. Return only the specified diagnostic acknowledgement.";
export const DIAGNOSTIC_CLI_REQUEST = `${DIAGNOSTIC_BASELINE}\nReturn this exact JSON acknowledgement, without tools:\n`;
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

const diagnosticEvidenceSchema = z.object({
  service: z.literal("claude-code"),
  runtimeVersion: z.string().min(1).max(80),
  requestedModel: z.enum(["sonnet", "opus", "haiku"]),
  reportedModels: z.array(z.string().min(1).max(200)).max(10),
  modelEvidence: z.enum(["cli-reported-unverified", "unavailable"]),
}).strict();

export const diagnosticStateSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  phase: z.literal("baseline").or(z.literal("loop")),
  baseline: z.object({ id: z.string().uuid(), text: z.literal(DIAGNOSTIC_BASELINE) }).strict(),
  events: z.array(z.object({
    id: z.string().uuid(),
    turn: diagnosticTurnSchema,
    generator: diagnosticEvidenceSchema.optional(),
  }).strict()).max(1),
  task: z.object({ id: z.string().uuid(), revision: z.number().int().nonnegative() }).strict().optional(),
  pendingResponse: z.never().optional(),
  shortStepReason: z.never().optional(),
}).strict().refine(state => state.phase === (state.events.length === 0 ? "baseline" : "loop"));

export const diagnosticSubmissionSchema = z.object({
  taskId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  candidate: diagnosticTurnSchema,
}).strict();

export const diagnosticReceiptSchema = z.object({
  sessionId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  eventId: z.string().uuid(),
});
