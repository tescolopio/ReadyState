import { z } from "zod";

import { feedbackSchema, TARGET_DURATION_HOURS, turnSchema, type TurnOutput } from "@/lib/exercise-contracts";

export const EXERCISE_ACCEPTANCE_VERSION = "1";
const text = z.string().min(1).max(8_000).refine(value => value.trim().length > 0);
const items = z.array(text).max(20);

export const exerciseTurnCandidateSchema = turnSchema.extend({
  narrative_response: text.meta({ description: turnSchema.shape.narrative_response.description }),
  new_inject: text.meta({ description: turnSchema.shape.new_inject.description }),
  time_elapsed: z.string().max(40).meta({ description: turnSchema.shape.time_elapsed.description }),
  hours_elapsed: z.number().min(0).max(TARGET_DURATION_HOURS).meta({ description: turnSchema.shape.hours_elapsed.description }),
  feedback: feedbackSchema.extend({
    covered: items.meta({ description: feedbackSchema.shape.covered.description }),
    consider: items.meta({ description: feedbackSchema.shape.consider.description }),
    why: text.meta({ description: feedbackSchema.shape.why.description }),
  }).strict().nullable().meta({ description: turnSchema.shape.feedback.description }),
  critical_alerts: items.meta({ description: turnSchema.shape.critical_alerts.description }),
  suggested_actions: z.array(text).max(2).meta({ description: turnSchema.shape.suggested_actions.description }),
  response_options: z.array(text).max(4).meta({ description: turnSchema.shape.response_options.description }),
}).strict();

export interface TurnClockPolicy {
  previousHour: number | null;
  /** Approved by the local app, not by assistant-supplied candidate metadata. */
  shortStepReason?: string;
}

export interface TurnProblem {
  field: string;
  code: "shape" | "clock" | "phase" | "cardinality";
}

export type TurnValidation =
  | { ok: true; turn: TurnOutput }
  | { ok: false; problems: TurnProblem[] };

/** Structural/progression checks only, not a safety or factual-quality verdict. */
export function validateExerciseTurn(candidate: unknown, policy: TurnClockPolicy): TurnValidation {
  const parsed = exerciseTurnCandidateSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map(issue => ({
      field: issue.path.join("."), code: "shape",
    })) };
  }
  const turn = parsed.data;
  const problems: TurnProblem[] = [];
  const issue = (field: string, code: TurnProblem["code"]) => problems.push({ field, code });
  const complete = turn.hours_elapsed === TARGET_DURATION_HOURS;

  if (turn.time_elapsed !== `Hour ${turn.hours_elapsed}`) issue("time_elapsed", "clock");
  if (policy.previousHour === null) {
    if (turn.hours_elapsed !== 0) issue("hours_elapsed", "clock");
    if (turn.feedback !== null) issue("feedback", "phase");
    if (turn.suggested_actions.length) issue("suggested_actions", "phase");
  } else {
    const previous = policy.previousHour;
    const delta = turn.hours_elapsed - previous;
    // Decimal-hour subtraction may land a few representable values off 6 or 12.
    const roundoff = Number.EPSILON * Math.max(1, Math.abs(previous), Math.abs(turn.hours_elapsed)) * 4;
    if (!Number.isFinite(previous) || previous < 0 || previous >= TARGET_DURATION_HOURS || delta <= 0 || delta > 12 + roundoff
      || (delta < 6 - roundoff && !complete && !policy.shortStepReason)) issue("hours_elapsed", "clock");
    if (turn.feedback === null) issue("feedback", "phase");
  }
  if (turn.scenario_status !== (complete ? "complete" : "ongoing")) issue("scenario_status", "phase");
  if (complete ? turn.response_options.length !== 0 : turn.response_options.length < 3) {
    issue("response_options", "cardinality");
  }
  return problems.length ? { ok: false, problems } : { ok: true, turn };
}
