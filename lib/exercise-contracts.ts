import { z } from "zod";

export const EXERCISE_SCHEMA_VERSION = "1";
export const TARGET_DURATION_HOURS = 72;

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

const improvementSchema = z.object({
  action: z
    .string()
    .describe(
      'One concrete next step, in one sentence, e.g. "Freeze two water jugs this week to use as ice and drinking water". One action, not a list of supplies: individual supplies go in supply_checklist.',
    ),
  evidence: z
    .string()
    .describe(
      'The exercise event or household fact it comes from, e.g. "Hour 18: the cooler warming" or "household profile: 1 gallon of water stored".',
    ),
  why: z.string().describe("One short sentence on why it matters, tied to that evidence."),
});

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
    .array(improvementSchema)
    .describe("At most three improvements, most important first. Fewer is fine: never pad the list to reach three."),
  supply_checklist: z
    .array(z.string())
    .describe("Optional: individual supplies worth gathering, one per item, for a household that wants a fuller list. Empty if the improvements cover it."),
});

export type TurnOutput = z.infer<typeof turnSchema>;
export type TurnFeedback = z.infer<typeof feedbackSchema>;
export type AfterActionReport = z.infer<typeof afterActionReportSchema>;
export type Improvement = z.infer<typeof improvementSchema>;
export type TtxPhase = "baseline" | "loop" | "ended" | "aar";

/** An improvement as one line, for plain-text reports. */
export const improvementText = ({ action, evidence, why }: Improvement) => `${action} Why: ${why} (from ${evidence})`;
