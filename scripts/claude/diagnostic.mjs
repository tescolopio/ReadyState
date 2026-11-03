// @ts-check
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { diagnosticSubmissionSchema, diagnosticTurn } from "../../lib/connection-diagnostic.mjs";
import { createDiagnosticClient, diagnosticConfig, DiagnosticError } from "./diagnostic-client.mjs";

/** @param {ReturnType<typeof createDiagnosticClient>} client */
export function createDiagnosticServer(client) {
  const server = new McpServer({ name: "readystate-diagnostic", version: "0.1.0" });
  const statusSchema = z.object({
    service: z.literal("assistant-hosted"), bridge: z.literal("connected"),
    sessionId: z.string().uuid(), diagnostic: z.enum(["accepted", "awaiting-acknowledgement"]),
    revision: z.number().int(), modelSelection: z.literal("assistant-interface"),
    modelEvidence: z.literal("unavailable"), disclosure: z.string(),
  });
  const receiptSchema = z.object({
    sessionId: z.string().uuid(), revision: z.number().int(), saved: z.literal(true), modelEvidence: z.literal("unavailable"),
  });
  const taskSchema = diagnosticSubmissionSchema;
  /** @param {() => Promise<object>} operation */
  async function result(operation) {
    try {
      const value = await operation();
      return { content: [{ type: /** @type {const} */ ("text"), text: JSON.stringify(value) }], structuredContent: value };
    } catch (error) {
      const text = error instanceof DiagnosticError ? error.message : "The diagnostic failed unexpectedly. Inspect local status/configuration and saved state before retrying.";
      return { isError: true, content: [{ type: /** @type {const} */ ("text"), text }] };
    }
  }
  server.registerTool("readystate_connection_status", {
    title: "Check ReadyState diagnostic connection",
    description: "Check only the configured fictional diagnostic session. Never expose household content; not a sign-in test or model identification. Model selection belongs to the assistant.",
    inputSchema: z.object({}).strict(), outputSchema: statusSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, (_input, context) => result(() => client.status(context.mcpReq.signal)));
  server.registerTool("readystate_get_diagnostic", {
    title: "Get fictional diagnostic acknowledgement",
    description: "Retrieve one bounded transport test. Pass its taskId, expectedRevision and exact candidate to readystate_submit_diagnostic. Not a household scenario or model-quality evaluation.",
    inputSchema: z.object({}).strict(), outputSchema: taskSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, (_input, context) => result(async () => {
    const task = await client.task(context.mcpReq.signal);
    return { taskId: task.id, expectedRevision: task.revision, candidate: diagnosticTurn };
  }));
  server.registerTool("readystate_submit_diagnostic", {
    title: "Save fictional diagnostic acknowledgement",
    description: "Validate and save the exact fictional acknowledgement. Retry an uncertain write with the original taskId and expectedRevision; this cannot create a duplicate event. Never include household data or model self-identification.",
    inputSchema: diagnosticSubmissionSchema, outputSchema: receiptSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, (input, context) => result(() => client.submit(input, context.mcpReq.signal)));
  return server;
}

export function startDiagnostic() {
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new DiagnosticError("The source diagnostic connector requires Node 24.");
  const config = diagnosticConfig({
    origin: process.env.READYSTATE_CONNECTOR_ORIGIN,
    sessionId: process.env.READYSTATE_CONNECTOR_SESSION_ID,
    pairingCode: process.env.READYSTATE_CONNECTOR_PAIRING_CODE,
    token: process.env.READYSTATE_CONNECTOR_TOKEN,
  });
  const client = createDiagnosticClient(config);
  const handle = serveStdio(() => createDiagnosticServer(client));
  process.once("SIGINT", () => { void handle.close(); });
  process.once("SIGTERM", () => { void handle.close(); });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { startDiagnostic(); }
  catch (error) {
    console.error(error instanceof DiagnosticError ? error.message : "ReadyState diagnostic startup failed. Check source configuration.");
    process.exitCode = 1;
  }
}
