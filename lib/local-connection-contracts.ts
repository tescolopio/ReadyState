import { z } from "zod";

import { turnSchema } from "@/lib/exercise-contracts";
import { claudeCliEvidenceSchema, claudeRequestedModelSchema } from "@/lib/claude-cli-contracts";

const id = z.string().uuid();
const approval = z.object({ id, text: z.string().min(1).max(65_536) }).strict();
const command = z.object({ sessionId: id, expectedRevision: z.number().int().nonnegative(), key: z.string().min(1).max(128) }).strict();
export const LOCAL_SHORT_STEP_REASON = "Participant requests a shorter interval for a fast-moving crisis.";
export const localBrowserCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }).strict(),
  z.object({ action: z.literal("claude-status") }).strict(),
  z.object({ action: z.literal("claude-diagnostic"), sessionId: id, model: claudeRequestedModelSchema }).strict(),
  z.object({ action: z.literal("unlock"), code: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal("lock") }).strict(),
  z.object({ action: z.literal("create"), approval }).strict(),
  z.object({ action: z.literal("state"), sessionId: id }).strict(),
  z.object({ action: z.literal("response"), command, approval }).strict(),
  z.object({ action: z.literal("withdraw-response"), command }).strict(),
  z.object({ action: z.literal("cancel"), command }).strict(),
  z.object({ action: z.literal("short-step"), command, reason: z.literal(LOCAL_SHORT_STEP_REASON) }).strict(),
  z.object({ action: z.literal("pair"), sessionId: id, permission: z.enum(["read", "write"]) }).strict(),
  z.object({ action: z.literal("revoke"), connectionId: id }).strict(),
]);
export const localConnectorCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("redeem"), code: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal("state"), sessionId: id }).strict(),
  z.object({ action: z.literal("task"), sessionId: id }).strict(),
  z.object({ action: z.literal("turn"), command, taskId: id, candidate: z.unknown() }).strict(),
  z.object({ action: z.literal("turn-receipt"), command, taskId: id, candidate: z.unknown() }).strict(),
]);
const session = z.object({
  id, revision: z.number().int().nonnegative(), phase: z.enum(["baseline", "loop", "ended"]),
});
export const localConnectionViewSchema = z.object({
  sessions: z.array(session),
  connections: z.array(z.object({
    id, sessionId: id, permission: z.enum(["read", "write"]),
    paired: z.boolean(), expiresAt: z.number(),
  })),
});
export const localConnectionStateSchema = session.extend({
  baseline: approval,
  events: z.array(z.object({ id, response: approval.optional(), turn: turnSchema, generator: claudeCliEvidenceSchema.optional() })),
  pendingResponse: approval.optional(),
  task: z.object({ id, revision: z.number() }).optional(),
  shortStepReason: z.string().optional(),
});
export type LocalConnectionState = z.infer<typeof localConnectionStateSchema>;
