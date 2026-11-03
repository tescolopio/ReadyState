import { z } from "zod";

export const claudeRequestedModelSchema = z.enum(["sonnet", "opus", "haiku"]);
export const claudeCliEvidenceSchema = z.object({
  service: z.literal("claude-code"),
  runtimeVersion: z.string().min(1).max(80),
  requestedModel: claudeRequestedModelSchema,
  reportedModels: z.array(z.string().min(1).max(200)).max(10),
  modelEvidence: z.enum(["cli-reported-unverified", "unavailable"]),
}).strict();
export const claudeCliStatusSchema = z.object({
  installed: z.boolean(),
  version: z.string().optional(),
  authentication: z.enum(["native-subscription", "sign-in-required", "unsupported-authentication", "not-checked"]),
  evaluationEnabled: z.boolean(),
});
