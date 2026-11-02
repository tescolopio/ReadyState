import { z } from "zod";

import { householdSaveSchema } from "@/lib/household-saves";
import { guidedAssessmentSchema } from "@/lib/guided-water";
import { assessInventory } from "@/lib/inventory";
import { INVENTORY_RULES, SOURCES } from "@/lib/rules";
import { afterActionReportSchema, turnSchema, type TtxUIMessage } from "@/lib/ttx";

const text = z.string().max(200_000);
const id = z.string().min(1).max(100);
const turnPart = z.strictObject({
  type: z.literal("tool-generate_turn"), toolCallId: id, state: z.literal("output-available"),
  input: turnSchema.strict(), output: turnSchema.strict(),
});
const reportPart = z.strictObject({
  type: z.literal("tool-after_action_report"), toolCallId: id, state: z.literal("output-available"),
  input: afterActionReportSchema.strict(), output: afterActionReportSchema.strict(),
});
export const savedMessageSchema = z.strictObject({
  id, role: z.enum(["user", "assistant"]),
  parts: z.array(z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("text"), text }), turnPart, reportPart,
  ])).max(100),
  metadata: z.strictObject({
    debriefChecks: z.strictObject({
      passedImplementedChecks: z.boolean(), failedFirst: z.array(text),
      stillFailing: z.array(text).optional(),
      omittedImprovement: z.strictObject({ action: text, checks: z.array(text) }).optional(),
    }),
  }).optional(),
});
export const privacySnapshotSchema = z.strictObject({
  entityMap: z.record(z.string().regex(/^\[(?:Person|Pet|Medical|Location|Address|Postcode|Phone|Email|URL|ID) [1-9]\d*\]$/), text),
  alwaysMask: z.array(text).max(1000),
});
export const exerciseRecordSchema = z.strictObject({
  id, savedAt: z.iso.datetime(), profile: householdSaveSchema.shape.household.nullable(),
  sampleId: id.nullable(), draft: text,
  messages: z.array(savedMessageSchema).max(5000).refine(items => new Set(items.map(item => item.id)).size === items.length, "Duplicate messages"),
  privacy: privacySnapshotSchema,
});
export type ExerciseRecord = z.infer<typeof exerciseRecordSchema>;
export const assessmentRecordSchema = z.strictObject({
  id, savedAt: z.iso.datetime(), household: householdSaveSchema.shape.household,
  report: z.string().max(2_000_000),
});
export type AssessmentRecord = z.infer<typeof assessmentRecordSchema>;
export const localRecordsSchema = z.strictObject({
  version: z.literal(1),
  progress: z.union([z.literal("auto"), z.literal(null), z.number().int().min(0).max(5)]),
  assessments: z.array(assessmentRecordSchema).max(1000),
  exercises: z.array(exerciseRecordSchema).max(1000),
  activeExercise: exerciseRecordSchema.nullable(),
  guidedAssessment: guidedAssessmentSchema.optional(),
  currentAssessment: assessmentRecordSchema.nullable().default(null),
}).refine(value =>
  new Set(value.assessments.map(record => record.id)).size === value.assessments.length &&
  new Set(value.exercises.map(record => record.id)).size === value.exercises.length, "Duplicate historical records");
export type LocalRecords = z.infer<typeof localRecordsSchema>;
export const RECORDS_KEY = "readystate-local-records";
export const emptyLocalRecords = (): LocalRecords => ({
  version: 1, progress: "auto", assessments: [], exercises: [], activeExercise: null, currentAssessment: null,
});

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function unmaskSavedText(text: string, entityMap: Record<string, string>) {
  const tags = Object.keys(entityMap);
  if (!text || tags.length === 0) return text;
  const pattern = new RegExp(tags.sort((a, b) => b.length - a.length).map(escapeRegExp).join("|"), "g");
  return text.replace(pattern, tag => entityMap[tag] ?? tag);
}

/** Only participant-visible content, never eval captures, transport options or retry credentials. */
export function savedMessages(messages: TtxUIMessage[]): z.infer<typeof savedMessageSchema>[] {
  return messages.filter(message => message.role !== "system").map(message => {
    const parts: z.infer<typeof savedMessageSchema>["parts"] = [];
    for (const part of message.parts) {
      if (part.type === "text") parts.push({ type: "text", text: part.text });
      if (part.type === "tool-generate_turn" && part.state === "output-available") {
        parts.push({ type: part.type, state: "output-available", toolCallId: part.toolCallId, input: part.output, output: part.output });
      }
      if (part.type === "tool-after_action_report" && part.state === "output-available") {
        parts.push({ type: part.type, state: "output-available", toolCallId: part.toolCallId, input: part.output, output: part.output });
      }
    }
    return savedMessageSchema.parse({
      id: message.id, role: message.role, parts,
      ...(message.metadata?.debriefChecks ? { metadata: { debriefChecks: message.metadata.debriefChecks } } : {}),
    });
  });
}

export function createAssessmentRecord(household: z.infer<typeof householdSaveSchema>["household"]): AssessmentRecord {
  const findings = assessInventory(household, { scenario: false });
  const report = findings.map(finding => {
    const rule = INVENTORY_RULES.find(rule => rule.id === finding.rule);
    const sources = SOURCES.filter(source => rule?.sources.includes(source.id));
    return [
      `[${finding.category} / ${finding.status}] ${finding.finding}`,
      ...finding.evidence.map(item => `Supporting answer: ${item.label}: ${item.value === undefined ? "Not answered" : JSON.stringify(item.value)}`),
      ...(finding.action ? [`Next step: ${finding.action}`] : []),
      `Rule: ${finding.rule}`,
      ...sources.map(source => `Source: ${source.title} - ${source.url}`),
    ].join("\n");
  }).join("\n\n");
  return assessmentRecordSchema.parse({ id: crypto.randomUUID(), savedAt: new Date().toISOString(), household, report });
}
