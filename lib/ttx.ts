import { tool, type InferUITools, type UIDataTypes, type UIMessage } from "ai";
import { z } from "zod";

/** Survive this many in-game hours to win the exercise. */
export const TARGET_DURATION_HOURS = 72;

export const turnSchema = z.object({
  narrative_response: z
    .string()
    .describe(
      "Outcome of the participant's last action (or the inciting incident on the first turn), grounded in realistic physics and logistics.",
    ),
  time_elapsed: z
    .string()
    .describe('Human-readable exercise clock, e.g. "Hour 24".'),
  hours_elapsed: z
    .number()
    .describe("Total in-game hours elapsed since the inciting incident."),
  new_inject: z
    .string()
    .describe(
      "A new localized complication (curveball) the participant must react to next.",
    ),
  critical_alerts: z
    .array(z.string())
    .describe(
      "Short, urgent warnings about unmet critical constraints (e.g. water, heat, medication). Empty if none.",
    ),
  scenario_status: z
    .enum(["ongoing", "failed", "survived"])
    .describe(
      '"failed" if a critical constraint was not secured, "survived" once the target duration is reached, otherwise "ongoing".',
    ),
});

export const afterActionReportSchema = z.object({
  overall_grade: z
    .enum(["A", "B", "C", "D", "F"])
    .describe("Letter grade for the participant's overall performance."),
  score: z.number().describe("Numeric score from 0 to 100."),
  outcome: z.enum(["failed", "survived"]),
  summary: z.string().describe("Two to four sentence executive summary."),
  strengths: z.array(z.string()).describe("Decisions that went well."),
  supply_gaps: z
    .array(z.string())
    .describe("Specific supplies or capabilities that were missing."),
  recommendations: z
    .array(z.string())
    .describe("Concrete preparedness actions to take before a real event."),
});

export type TurnOutput = z.infer<typeof turnSchema>;
export type AfterActionReport = z.infer<typeof afterActionReportSchema>;

/**
 * Structured "tools" the model is forced to call. They simply echo their
 * validated input so the turn data is persisted in the chat history as a
 * completed tool result.
 */
export const ttxTools = {
  generate_turn: tool({
    description:
      "Report the result of the participant's action, advance the clock and introduce the next inject.",
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

export type TtxUIMessage = UIMessage<
  never,
  UIDataTypes,
  InferUITools<typeof ttxTools>
>;

/**
 * Phase 1 `baseline`: waiting for sanitized household parameters.
 * Phase 2 `loop`: action -> result + inject, time advances.
 * Phase 3 `ended`: a critical constraint failed or the target duration was reached.
 * Phase 4 `aar`: the After-Action Report has been generated.
 */
export type TtxPhase = "baseline" | "loop" | "ended" | "aar";

export interface TtxState {
  phase: TtxPhase;
  turns: TurnOutput[];
  latestTurn?: TurnOutput;
  hoursElapsed: number;
  outcome?: "failed" | "survived";
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

  let outcome: TtxState["outcome"];
  if (latestTurn?.scenario_status === "failed") outcome = "failed";
  else if (
    latestTurn?.scenario_status === "survived" ||
    (latestTurn && hoursElapsed >= targetHours)
  )
    outcome = "survived";

  let phase: TtxPhase = "baseline";
  if (report) phase = "aar";
  else if (outcome) phase = "ended";
  else if (latestTurn) phase = "loop";

  return { phase, turns, latestTurn, hoursElapsed, outcome, report };
}

const messageText = (message: TtxUIMessage) =>
  message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();

const alertsLine = (alerts: string[]) =>
  alerts.length ? alerts.join("; ") : "none";

/**
 * Builds the compact model prompt for the next call. Instead of replaying the
 * whole chat (where every turn appears twice, as tool call and echoed result),
 * it sends the baseline, a one-line log entry per older turn, the latest turn
 * in full and the participant's pending action. Older narratives are dropped:
 * the actions, injects and alerts carry the state the model needs, and the
 * prompt grows by a line per turn instead of a full transcript.
 */
export function buildExercisePrompt(messages: TtxUIMessage[]): string {
  let baseline: string | undefined;
  let pendingAction: string | undefined;
  const exchanges: Array<{ action?: string; turn: TurnOutput }> = [];

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

  const sections = [`HOUSEHOLD BASELINE (sanitized):\n${baseline ?? "(not provided)"}`];

  const latest = exchanges.at(-1);
  const older = exchanges.slice(0, -1);
  if (older.length) {
    const log = older.map(({ action, turn }) => {
      const did = action ? `Participant: ${action} | ` : "";
      return `- ${turn.time_elapsed}: ${did}Inject: ${turn.new_inject} | Alerts: ${alertsLine(turn.critical_alerts)}`;
    });
    sections.push(`EXERCISE LOG (earlier turns, condensed):\n${log.join("\n")}`);
  }

  if (latest) {
    const { action, turn } = latest;
    sections.push(
      [
        `LATEST TURN (${turn.time_elapsed}, hours_elapsed ${turn.hours_elapsed}):`,
        ...(action ? [`Participant action: ${action}`] : []),
        `Outcome: ${turn.narrative_response}`,
        `Inject: ${turn.new_inject}`,
        `Critical alerts: ${alertsLine(turn.critical_alerts)}`,
      ].join("\n"),
    );
  }

  if (pendingAction) sections.push(`PARTICIPANT ACTION:\n${pendingAction}`);

  return sections.join("\n\n");
}
