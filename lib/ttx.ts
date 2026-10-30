import { tool, type InferUITools, type UIDataTypes, type UIMessage } from "ai";
import { z } from "zod";

/** The exercise runs for this many in-game hours. */
export const TARGET_DURATION_HOURS = 72;

/** Feedback on one response, in the three parts the design brief specifies. */
export const feedbackSchema = z.object({
  covered: z
    .array(z.string())
    .describe("What the response handled well, specific to what the participant actually wrote."),
  consider: z
    .array(z.string())
    .describe("Considerations the response missed or could strengthen. Empty if nothing important."),
  why: z
    .string()
    .describe(
      "One to three sentences on why these points matter, grounded in preparedness guidance. Acknowledge other reasonable approaches.",
    ),
});

export const turnSchema = z.object({
  feedback: feedbackSchema
    .nullable()
    .describe("Feedback on the participant's latest response. null on the first turn, when there is no response yet."),
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
  suggested_actions: z
    .array(z.string())
    .describe(
      "Zero to two practical real-world preparedness steps that follow from this turn's lesson, e.g. \"Store a second cooler and freeze water jugs\".",
    ),
  response_options: z
    .array(z.string())
    .describe(
      "Three or four distinct, plausible responses to new_inject, written in the first person as the participant would (\"I move everyone into the basement and…\"). Vary the approach and quality: include sound options and at least one tempting but flawed one, never an absurd one, and don't indicate which is best. Empty once the exercise is complete.",
    ),
  scenario_status: z
    .enum(["ongoing", "complete"])
    .describe(`"complete" once hours_elapsed reaches the exercise length, otherwise "ongoing".`),
});

/**
 * End-of-exercise debrief. There's no win or lose (decision D8): it answers
 * "what do I need to know?" and "what can I/we do better?".
 */
export const afterActionReportSchema = z.object({
  summary: z
    .string()
    .describe("Two to four sentences on what the exercise showed about this household's situation and plan."),
  went_well: z
    .array(z.string())
    .describe("Decisions and preparations that helped, specific to what the participant actually did."),
  need_to_know: z
    .array(z.string())
    .describe(
      'What this household needs to know about its own situation, learned from the exercise: dependencies, timings and risks, stated factually. End each with where it comes from, e.g. "Without power, your cooler keeps the insulin in range for about a day if the ice is replaced (from Hour 18: the cooler warming)".',
    ),
  do_better: z
    .array(z.string())
    .describe(
      'One to three improvements, most important first. Each is one sentence naming the improvement and one concrete next action, ending with where it comes from, e.g. "Freeze two water jugs this week to use as ice and drinking water (from Hour 18: the cooler warming)". Put longer supply lists in supply_checklist instead.',
    ),
  supply_checklist: z
    .array(z.string())
    .describe("Optional: individual supplies worth gathering, one per item, for a household that wants a fuller list. Empty if the improvements cover it."),
});

export type TurnOutput = z.infer<typeof turnSchema>;
export type TurnFeedback = z.infer<typeof feedbackSchema>;
export type AfterActionReport = z.infer<typeof afterActionReportSchema>;

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

/**
 * What the server reports about the model call behind a response, for the
 * eval: actual token usage and how many provider calls it took (1, or 2
 * after a retried malformed turn). Never shown to participants.
 */
export interface TtxMetadata {
  usage?: { inputTokens?: number; outputTokens?: number };
  modelCalls?: number;
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
export type TtxPhase = "baseline" | "loop" | "ended" | "aar";

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

const alertsLine = (alerts: string[]) =>
  alerts.length ? alerts.join("; ") : "none";

/** Earlier turns kept as full log lines; anything older gets one short line (work item G6). */
export const RECENT_LOG_TURNS = 4;

/** Text cut to about `max` characters at a word boundary. */
const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > max / 2 ? cut.slice(0, space) : cut}…`;
};

const firstSentence = (text: string) => text.match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? text;

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
    const firstRecent = older.length - RECENT_LOG_TURNS;
    const log = older.map(({ action, turn }, index) => {
      if (index < firstRecent) {
        const did = action ? `Participant: ${clip(action, 100)} | ` : "";
        return `- ${turn.time_elapsed}: ${did}Inject: ${clip(firstSentence(turn.new_inject), 140)}`;
      }
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
