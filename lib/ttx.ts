import { tool, type InferUITools, type UIDataTypes, type UIMessage } from "ai";

import type { DebriefCapture } from "@/lib/debrief-capture";
import { buildExerciseBriefing, type ExerciseExchange } from "@/lib/exercise-context";
import {
  afterActionReportSchema, TARGET_DURATION_HOURS, turnSchema,
  type AfterActionReport, type TurnOutput, type TtxPhase,
} from "@/lib/exercise-contracts";
export { RECENT_LOG_TURNS } from "@/lib/exercise-context";

export {
  afterActionReportSchema, feedbackSchema, improvementText, TARGET_DURATION_HOURS, turnSchema,
  type AfterActionReport, type Improvement, type TurnFeedback, type TurnOutput, type TtxPhase,
} from "@/lib/exercise-contracts";

/**
 * Structured "tools" the model is forced to call. They simply echo their
 * validated input so the turn data is persisted in the chat history as a
 * completed tool result.
 */
export const ttxTools = {
  generate_turn: tool({
    description:
      "Give feedback on the participant's response, report its result, advance the clock and introduce the next inject.",
    inputSchema: turnSchema,
    execute: async (input) => input,
  }),
  after_action_report: tool({
    description:
      "Produce the structured After-Action Report (AAR) once the exercise has ended.",
    inputSchema: afterActionReportSchema,
    execute: async (input) => input,
  }),
};

/** An improvement the server dropped after the repair, and the checks it failed (lib/debrief-checks.ts, omitKitImprovement). */
export interface OmittedImprovement {
  action: string;
  checks: string[];
}

export const OMITTED_IMPROVEMENT_NOTICE = "One suggested improvement was omitted because it didn't meet our quality checks.";

/**
 * What the server reports about the model calls behind a response, for the
 * eval. Never shown to participants, except the omitted-improvement notice.
 */
export interface TtxMetadata {
  /** Actual tokens, as the provider reported them. */
  usage?: { inputTokens?: number; outputTokens?: number };
  /** Every provider call, including the SDK's silent retries after a rate limit. */
  providerCalls?: number;
  /** Retries after a malformed tool call (work item G4). */
  schemaRetries?: number;
  /** Debrief repairs after failed content checks (0 or 1). */
  debriefRepairs?: number;
  /**
   * The debrief's result against lib/debrief-checks.ts: the implemented
   * checks, not a verification of safety or accuracy. `failedFirst` lists
   * what the first attempt failed, before its repair; `stillFailing`, what a
   * rejected repair still failed. Sent with the error, too, when a debrief is
   * rejected. `omittedImprovement` is set when the server dropped a kit-list
   * improvement the repair kept; it is the one field the page shows, as
   * OMITTED_IMPROVEMENT_NOTICE.
   */
  debriefChecks?: { passedImplementedChecks: boolean; failedFirst: string[]; stillFailing?: string[]; omittedImprovement?: OmittedImprovement };
  /** Every debrief draft and what it failed, only when a local eval asks for it (lib/debrief-capture.ts). Never displayed. */
  debriefCapture?: DebriefCapture;
}

export type TtxUIMessage = UIMessage<
  TtxMetadata,
  UIDataTypes,
  InferUITools<typeof ttxTools>
>;

/**
 * Phase 1 `baseline`: waiting for sanitized household parameters.
 * Phase 2 `loop`: action -> result + inject, time advances.
 * Phase 3 `ended`: the exercise reached its full length. There is no fail state
 * (decision D8): setbacks are consequences to respond to, not game over.
 * Phase 4 `aar`: the After-Action Report has been generated.
 */
export interface TtxState {
  phase: TtxPhase;
  turns: TurnOutput[];
  latestTurn?: TurnOutput;
  hoursElapsed: number;
  report?: AfterActionReport;
}

type CompletedPart<T> = { state: string; input?: unknown; output?: T };

const completedOutput = <T>(part: CompletedPart<T>): T | undefined =>
  part.state === "output-available" ? part.output : undefined;

/** Pure state machine: derives the current exercise phase from chat history. */
export function deriveTtxState(
  messages: TtxUIMessage[],
  targetHours: number = TARGET_DURATION_HOURS,
): TtxState {
  const turns: TurnOutput[] = [];
  let report: AfterActionReport | undefined;

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (part.type === "tool-generate_turn") {
        const turn = completedOutput<TurnOutput>(part);
        if (turn) turns.push(turn);
      } else if (part.type === "tool-after_action_report") {
        report = completedOutput<AfterActionReport>(part) ?? report;
      }
    }
  }

  const latestTurn = turns.at(-1);
  const hoursElapsed = latestTurn?.hours_elapsed ?? 0;

  const complete =
    latestTurn?.scenario_status === "complete" || (latestTurn !== undefined && hoursElapsed >= targetHours);

  let phase: TtxPhase = "baseline";
  if (report) phase = "aar";
  else if (complete) phase = "ended";
  else if (latestTurn) phase = "loop";

  return { phase, turns, latestTurn, hoursElapsed, report };
}

const messageText = (message: TtxUIMessage) =>
  message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();

/** What the participant sent, in order: the household baseline first, then each response. */
/** What the exercise page sends to ask for the debrief; it isn't a participant action. */
export const DEBRIEF_REQUEST = "The exercise is over. Please prepare the debrief.";

/**
 * The baseline and the participant's response after each completed turn: `responses[i]` follows `turns[i]`, or is
 * empty if none did. Messages are walked in order, as `buildExercisePrompt` does, so a resent response after a failed
 * turn replaces the first rather than shifting every later one; the debrief request isn't counted.
 */
export function participantResponses(messages: TtxUIMessage[]): { baseline: string; responses: string[] } {
  let baseline: string | undefined;
  const responses: string[] = [];
  let turns = 0;
  for (const message of messages) {
    if (message.role === "user") {
      const text = messageText(message);
      if (!text || text === DEBRIEF_REQUEST) continue;
      if (baseline === undefined) baseline = text;
      else if (turns > 0) responses[turns - 1] = text;
      continue;
    }
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (part.type === "tool-generate_turn" && completedOutput<TurnOutput>(part)) turns++;
    }
  }
  return { baseline: baseline ?? "", responses: Array.from({ length: turns }, (_, i) => responses[i] ?? "") };
}

/**
 * Builds the compact model prompt for the next call. Instead of replaying the
 * whole chat (where every turn appears twice, as tool call and echoed result),
 * it sends the baseline, a one-line log entry per older turn, the latest turn
 * in full and the participant's pending action. Older narratives are dropped:
 * the actions, injects and alerts carry the state the model needs. Past the
 * last few turns, entries shrink to the action and the inject's first
 * sentence, so a long game grows by a short line per turn.
 */
export function buildExercisePrompt(messages: TtxUIMessage[]): string {
  let baseline: string | undefined;
  let pendingAction: string | undefined;
  const exchanges: ExerciseExchange[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      const text = messageText(message);
      if (!text) continue;
      if (baseline === undefined) baseline = text;
      else pendingAction = text;
      continue;
    }
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (part.type !== "tool-generate_turn") continue;
      const turn = completedOutput<TurnOutput>(part);
      if (!turn) continue;
      exchanges.push({ action: pendingAction, turn });
      pendingAction = undefined;
    }
  }

  return buildExerciseBriefing({ baseline, exchanges, pendingAction });
}
