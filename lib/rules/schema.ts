/**
 * Schema for the rules database in data/rules/. Rules are content, not code:
 * each one names its sources and review status, so the Research team can add
 * and review them (work items R1, R3, R5, D6) without touching the engine.
 * See docs/architecture/rules.md.
 */
import { z } from "zod";

/** Draft rules work but haven't had the review D6 requires; reviewed ones name who signed off. */
const review = {
  status: z.enum(["draft", "reviewed"]),
  reviewedBy: z.string().optional(),
  sources: z.array(z.string()).min(1),
  notes: z.string().optional(),
};

export const sourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  publisher: z.string(),
  url: z.url(),
  /** Public domain (US government works) or a license; copyrighted sources are cited, never copied. */
  license: z.enum(["public-domain", "cite-only"]),
  /** Date someone last checked the page says what the rules claim; null until verified. */
  verified: z.string().nullable(),
});

/**
 * A condition over facts derived from the household profile (see
 * `profileFacts` in lib/rules/engine.ts). Leaves compare one fact; `all`,
 * `any` and `not` combine them.
 */
export type Condition =
  | { fact: string; equals: string | number | boolean }
  | { fact: string; in: Array<string | number> }
  | { fact: string; includes: string }
  | { fact: string; includesAll: string[] }
  | { fact: string; includesAny: string[] }
  | { fact: string; gt: number }
  | { fact: string; lt: number }
  | { fact: string; exists: boolean }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ fact: z.string(), equals: z.union([z.string(), z.number(), z.boolean()]) }).strict(),
    z.object({ fact: z.string(), in: z.array(z.union([z.string(), z.number()])) }).strict(),
    z.object({ fact: z.string(), includes: z.string() }).strict(),
    z.object({ fact: z.string(), includesAll: z.array(z.string()) }).strict(),
    z.object({ fact: z.string(), includesAny: z.array(z.string()) }).strict(),
    z.object({ fact: z.string(), gt: z.number() }).strict(),
    z.object({ fact: z.string(), lt: z.number() }).strict(),
    z.object({ fact: z.string(), exists: z.boolean() }).strict(),
    z.object({ all: z.array(conditionSchema) }).strict(),
    z.object({ any: z.array(conditionSchema) }).strict(),
    z.object({ not: conditionSchema }).strict(),
  ]),
);

const findingFields = {
  id: z.string(),
  /** Finding id; may use templates, e.g. "{person.id}-cold-chain" for per-person rules. */
  findingId: z.string().optional(),
  area: z.enum(["Water", "Food", "Pets", "Medical", "Power", "Safety", "Kit", "Plan"]),
  kind: z.enum(["get", "plan"]),
  /** The guidance record this rule implements; tests check its thresholds match. */
  guidance: z.string().optional(),
  /** "need" runs the rule once per recorded need, adding person.* and need.* facts. */
  forEach: z.literal("need").optional(),
  when: conditionSchema.optional(),
  ...review,
};

/**
 * Grades a days-of-supply metric: below `minimum` is short, below `goal` is
 * partial, otherwise ok. Templates can use {days} and {shortBy}, plus any fact.
 */
export const supplyRuleSchema = z.object({
  ...findingFields,
  type: z.literal("supply"),
  metric: z.string(),
  minimum: z.number(),
  goal: z.number().optional(),
  messages: z.object({
    unknown: z.string(),
    short: z.string(),
    partial: z.string().optional(),
    ok: z.string(),
  }),
  actions: z.object({
    unknown: z.string(),
    short: z.string(),
    partial: z.string().optional(),
  }),
});

/** Applies when `when` holds; a finding unless `pass` also holds. With no `pass` it always reports. */
export const checkRuleSchema = z.object({
  ...findingFields,
  type: z.literal("check"),
  pass: conditionSchema.optional(),
  failStatus: z.enum(["missing", "short", "partial", "unknown"]),
  finding: z.string(),
  action: z.string(),
  /** Report a "Covered" finding when it passes (otherwise passing rules stay silent). */
  reportOk: z.boolean().optional(),
});

/** A checklist of supply items. Templates can use {missingCount}, {total} and {missingList}. */
export const kitRuleSchema = z.object({
  ...findingFields,
  type: z.literal("kit"),
  items: z.record(z.string(), z.string()),
  /** Status when more than this many items are missing; fewer is partial. */
  shortAbove: z.number(),
  finding: z.string(),
  action: z.string(),
  okFinding: z.string(),
});

export const inventoryRuleSchema = z.discriminatedUnion("type", [supplyRuleSchema, checkRuleSchema, kitRuleSchema]);

/** A safety rule: told to the model, and checked in evaluations. */
export const safetyRuleSchema = z.object({
  id: z.string(),
  /** One line added to the system prompt. */
  prompt: z.string(),
  /** Patterns (case-insensitive regular expressions) that flag advice breaking the rule. */
  detect: z.array(z.string()).optional(),
  /** A sentence matching this is a warning about the hazard, not advice to do it. */
  exceptWhen: z.string().optional(),
  ...review,
});

/**
 * One authoritative fact, such as "1 gallon of water per person per day".
 * `quote` is the source's exact words (US government works only; copyrighted
 * sources are paraphrased in `statement`). Records with `prompt` are sent to
 * the scenario engine when `when` holds for the household.
 */
export const guidanceSchema = z.object({
  id: z.string(),
  topic: z.string(),
  statement: z.string(),
  /** A compact form sent to the model (records with `prompt`), to keep each call small. */
  brief: z.string().optional(),
  quote: z.string().optional(),
  values: z.record(z.string(), z.number()),
  prompt: z.boolean().optional(),
  when: conditionSchema.optional(),
  ...review,
});

export const STAGES = ["warning", "first-hours", "first-day", "days-2-3"] as const;

/** Something a sound response should cover at a stage of an emergency (G13, HSEEP critical tasks). */
export const lookForSchema = z.object({
  id: z.string(),
  scenarios: z.array(z.string()).min(1),
  stage: z.enum(STAGES),
  when: conditionSchema.optional(),
  task: z.string(),
  why: z.string(),
  ...review,
});

export type Source = z.infer<typeof sourceSchema>;
export type InventoryRule = z.infer<typeof inventoryRuleSchema>;
export type SafetyRule = z.infer<typeof safetyRuleSchema>;
export type LookFor = z.infer<typeof lookForSchema>;
export type Guidance = z.infer<typeof guidanceSchema>;
