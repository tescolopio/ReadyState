import { z } from "zod";

import { feedbackSchema, TARGET_DURATION_HOURS, turnSchema, type TurnOutput } from "@/lib/exercise-contracts";

export const EXERCISE_ACCEPTANCE_VERSION = "1";
const text = z.string().min(1).max(8_000).refine(value => value.trim().length > 0);
const items = z.array(text).max(20);

export const exerciseTurnCandidateSchema = turnSchema.extend({
  narrative_response: text,
  new_inject: text,
  time_elapsed: z.string().max(40),
  hours_elapsed: z.number().min(0).max(TARGET_DURATION_HOURS),
  feedback: feedbackSchema.extend({ covered: items, consider: items, why: text }).strict().nullable(),
  critical_alerts: items,
  suggested_actions: z.array(text).max(2),
  response_options: z.array(text).max(4),
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
    if (!Number.isFinite(previous) || previous < 0 || previous >= TARGET_DURATION_HOURS || delta <= 0 || delta > 12
      || (delta < 6 && !complete && !policy.shortStepReason)) issue("hours_elapsed", "clock");
    if (turn.feedback === null) issue("feedback", "phase");
  }
  if (turn.scenario_status !== (complete ? "complete" : "ongoing")) issue("scenario_status", "phase");
  if (complete ? turn.response_options.length !== 0 : turn.response_options.length < 3) {
    issue("response_options", "cardinality");
  }
  return problems.length ? { ok: false, problems } : { ok: true, turn };
}
