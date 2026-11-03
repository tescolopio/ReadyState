// @ts-check
import { z } from "zod";
import {
  diagnosticReceiptSchema, diagnosticStateSchema, diagnosticSubmissionSchema,
} from "../../lib/connection-diagnostic.mjs";

const secret = z.string().regex(/^[a-f0-9]{64}$/);
const configSchema = z.object({
  origin: z.string().refine(value => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        && !url.username && !url.password && url.origin === value;
    } catch { return false; }
  }),
  sessionId: z.string().uuid(),
  pairingCode: secret.optional(),
  token: secret.optional(),
}).strict().refine(config => Boolean(config.pairingCode) !== Boolean(config.token));
const redeemedSchema = z.object({
  token: secret, sessionId: z.string().uuid(), permission: z.enum(["read", "write"]),
});
const taskSchema = z.object({ id: z.string().uuid(), revision: z.number().int().nonnegative() });

export class DiagnosticError extends Error {}

/** @param {unknown} value */
export function diagnosticConfig(value) {
  const parsed = configSchema.safeParse(value);
  if (!parsed.success) throw new DiagnosticError("Set an exact HTTP loopback origin, diagnostic session ID, and exactly one pairing code or token in local configuration. Never put credentials in chat.");
  return parsed.data;
}

/**
 * @param {z.infer<typeof configSchema>} config
 * @param {typeof fetch} request
 */
export function createDiagnosticClient(config, request = fetch) {
  let token = config.token;
  /** @type {Promise<void> | undefined} */
  let pairing;

  /** @param {unknown} body @param {AbortSignal} signal @param {string | undefined} credential */
  async function post(body, signal, credential) {
    let response;
    try {
      response = await request(`${config.origin}/api/local-connector`, {
        method: "POST", redirect: "error", credentials: "omit",
        headers: { "Content-Type": "application/json", ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
    } catch {
      throw new DiagnosticError("ReadyState is disconnected, cancelled or timed out. Start the configured local server; inspect saved state before retrying an unconfirmed submission.");
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401) throw new DiagnosticError("Pairing expired, was revoked, lacks permission or belongs to another session. Create a fresh code with the required permission for this same diagnostic session, update local configuration and reconnect.");
      if (response.status === 403) throw new DiagnosticError("The exact local origin was refused. Match ReadyState's configured localhost/IP and port; do not switch browser origins.");
      if (response.status === 409) throw new DiagnosticError("The diagnostic task or output was refused. Inspect status and retrieve the current task; retry an unconfirmed submission with its original task ID and revision.");
      throw new DiagnosticError("ReadyState could not complete the diagnostic. Check local configuration/storage and saved state; do not assume it was saved.");
    }
    if (!response.body) throw new DiagnosticError("ReadyState returned an empty response.");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 150_000) {
          await reader.cancel();
          throw new DiagnosticError("ReadyState returned an oversized diagnostic response.");
        }
        chunks.push(value);
      }
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw new DiagnosticError("ReadyState returned invalid diagnostic JSON. Update the server and connector together."); }
    } catch (error) {
      if (error instanceof DiagnosticError) throw error;
      throw new DiagnosticError("The diagnostic response was interrupted. Inspect saved state before retrying.");
    } finally { reader.releaseLock(); }
  }

  /** @param {unknown} body @param {AbortSignal} signal */
  async function authenticated(body, signal) {
    if (!token) {
      // Redemption is one-use: never repeat automatically after a lost response.
      pairing ??= (async () => {
        let response;
        try { response = await post({ action: "redeem", code: config.pairingCode }, signal, undefined); }
        catch {
          throw new DiagnosticError("Pairing could not be confirmed; the one-use code may already be consumed. Revoke any unconfirmed connection, create a fresh code for this same diagnostic session, update local configuration and reconnect. Redemption is not retried automatically.");
        }
        const parsed = redeemedSchema.safeParse(response);
        if (!parsed.success || parsed.data.sessionId !== config.sessionId) {
          throw new DiagnosticError("Pairing did not match the configured diagnostic session. Revoke this connection and create a fresh code for the intended session.");
        }
        token = parsed.data.token;
      })();
      await pairing;
    }
    return post(body, signal, token);
  }

  /** @param {AbortSignal} signal */
  async function state(signal) {
    const parsed = diagnosticStateSchema.safeParse(await authenticated({ action: "state", sessionId: config.sessionId }, signal));
    if (!parsed.success || parsed.data.id !== config.sessionId) {
      throw new DiagnosticError("This connection is not a fixed ReadyState diagnostic session. No household content will be returned or submitted. Create and pair a fictional connection diagnostic instead.");
    }
    return parsed.data;
  }

  return {
    /** @param {AbortSignal} signal */
    async status(signal) {
      const saved = await state(signal);
      return {
        service: "assistant-hosted", bridge: "connected", sessionId: saved.id,
        diagnostic: saved.events.length === 1 ? "accepted" : "awaiting-acknowledgement",
        revision: saved.revision,
        modelSelection: "assistant-interface", modelEvidence: "unavailable",
        disclosure: "The local bridge responded. This does not verify Claude sign-in, model availability, model identity or scenario quality.",
      };
    },
    /** @param {AbortSignal} signal */
    async task(signal) {
      const saved = await state(signal);
      if (saved.events.length) throw new DiagnosticError("This diagnostic is already saved. Check status and refresh ReadyState; do not create another write.");
      const parsed = taskSchema.safeParse(await authenticated({ action: "task", sessionId: config.sessionId }, signal));
      if (!parsed.success) throw new DiagnosticError("ReadyState returned an incompatible diagnostic task.");
      return parsed.data;
    },
    /** @param {unknown} input @param {AbortSignal} signal */
    async submit(input, signal) {
      const parsed = diagnosticSubmissionSchema.safeParse(input);
      if (!parsed.success) throw new DiagnosticError("Invalid diagnostic output. Return exactly the fixed fictional acknowledgement from readystate_get_diagnostic; no free text or household data is accepted.");
      await state(signal);
      const { taskId, expectedRevision, candidate } = parsed.data;
      const result = diagnosticReceiptSchema.safeParse(await authenticated({
        action: "turn", command: { sessionId: config.sessionId, expectedRevision, key: `diagnostic-v1:${taskId}` }, taskId, candidate,
      }, signal));
      if (!result.success || result.data.sessionId !== config.sessionId) throw new DiagnosticError("ReadyState returned an incompatible receipt. Inspect saved state before retrying.");
      return { ...result.data, saved: true, modelEvidence: "unavailable" };
    },
  };
}
