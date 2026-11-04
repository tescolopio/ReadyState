import { z } from "zod";
import { ClaudeCliError, type ClaudeCli } from "@/lib/claude-cli";
import { diagnosticStateSchema, diagnosticTurnSchema } from "@/lib/connection-diagnostic.mjs";

import { LocalConnectionAuth, LocalConnectionDenied } from "@/lib/local-connection-auth";
import { localBrowserCommandSchema, localConnectionStateSchema, localConnectorCommandSchema } from "@/lib/local-connection-contracts";
import { LocalExerciseError, LocalExerciseService } from "@/lib/local-exercise-service";

const COOKIE = "readystate-local-owner";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const runningDiagnostics = new Set<string>();
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { ...headers, ...extra } });
const ownerCookie = (token: string, age: number) =>
  `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/local-connection; Max-Age=${age}`;

export function localConnectionOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)
    || url.username || url.password || url.origin !== value) {
    throw new Error("Local connections require an exact HTTP loopback origin.");
  }
  return url.origin;
}

export function localConnectionRequestAllowed(request: Request, client: "browser" | "connector", origin: string) {
  const url = new URL(request.url);
  const configured = new URL(origin);
  // Next normalizes loopback Request URLs to localhost. Host and browser Origin
  // remain exact configured authorities; only the internal URL may use an alias.
  if (request.method !== "POST" || !LOOPBACK_HOSTS.has(url.hostname)
    || url.protocol !== configured.protocol || url.port !== configured.port
    || request.headers.get("host") !== configured.host) return false;
  const suppliedOrigin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  return client === "browser"
    ? suppliedOrigin === origin && (site === null || site === "same-origin")
    : suppliedOrigin === null && !request.headers.has("cookie");
}

async function boundedJson(request: Request) {
  if (!request.headers.get("content-type")?.match(/^application\/json(?:;|$)/i) || !request.body) {
    throw new LocalExerciseError("invalid-input");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 150_000) {
        await reader.cancel();
        throw new LocalExerciseError("invalid-input");
      }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
    catch { throw new LocalExerciseError("invalid-input"); }
  } finally { reader.releaseLock(); }
}

function command<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new LocalExerciseError("invalid-input");
  return parsed.data;
}

/** Transport credentials, origin checks and tool allowlist live outside the domain service. */
export async function handleLocalConnection(
  request: Request,
  client: "browser" | "connector",
  dependencies: { origin: string; auth: LocalConnectionAuth; exercises: LocalExerciseService; claude?: () => Pick<ClaudeCli, "status" | "diagnostic"> },
) {
  try {
    const { auth, exercises } = dependencies;
    const origin = localConnectionOrigin(dependencies.origin);
    if (!localConnectionRequestAllowed(request, client, origin)) {
      return json({ error: "Local connection origin refused." }, 403);
    }
    const input = await boundedJson(request);
    if (client === "browser") {
      const action = command(localBrowserCommandSchema, input);
      if (action.action === "unlock") {
        const token = auth.unlock(action.code);
        return json({ unlocked: true }, 200, { "Set-Cookie": ownerCookie(token, 12 * 60 * 60) });
      }
      const cookie = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim())
        .find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? "";
      const owner = auth.authenticateOwner(cookie);
      switch (action.action) {
        case "claude-status":
          if (!dependencies.claude) throw new ClaudeCliError("The local Claude CLI adapter is not configured.");
          return json(await dependencies.claude().status(request.signal));
        case "claude-diagnostic": {
          if (!dependencies.claude) throw new ClaudeCliError("The local Claude CLI adapter is not configured.");
          const localState = localConnectionStateSchema.safeParse(exercises.getState(action.sessionId, owner));
          const state = localState.success ? diagnosticStateSchema.safeParse(localState.data) : undefined;
          if (!state?.success) throw new ClaudeCliError("This session is incompatible with the ReadyState diagnostic protocol. No diagnostic result was accepted.");
          if (state.data.events.length) {
            return json(localConnectionStateSchema.parse(exercises.getState(action.sessionId, owner)));
          }
          if (runningDiagnostics.has(action.sessionId)) throw new ClaudeCliError("This diagnostic is already running. Wait or cancel it; no second request was started.");
          runningDiagnostics.add(action.sessionId);
          try {
            const task = exercises.getGenerationTask(action.sessionId, owner);
            const result = await dependencies.claude().diagnostic(action.model, request.signal);
            auth.authenticateOwner(cookie);
            if (request.signal.aborted) throw new ClaudeCliError("Claude request cancelled. Refresh saved results before retrying.");
            const candidate = diagnosticTurnSchema.safeParse(result.candidate);
            if (!candidate.success) throw new ClaudeCliError("Claude did not return the exact diagnostic acknowledgement. Nothing was accepted.");
            exercises.submitTurn(owner, {
              sessionId: action.sessionId, expectedRevision: task.revision, key: `claude-diagnostic-v1:${task.id}`,
            }, task.id, candidate.data, result.evidence);
            return json(localConnectionStateSchema.parse(exercises.getState(action.sessionId, owner)));
          } finally { runningDiagnostics.delete(action.sessionId); }
        }
        case "lock":
          auth.lock(cookie);
          return json({ unlocked: false }, 200, { "Set-Cookie": ownerCookie("", 0) });
        case "status":
          return json({ sessions: exercises.listOwnedSessions(owner), connections: auth.list() });
        case "state":
          return json(localConnectionStateSchema.parse(exercises.getState(action.sessionId, owner)));
        case "create":
          return json(exercises.createApprovedSession(owner, action.approval));
        case "response":
          return json(exercises.submitApprovedResponse(owner, action.command, action.approval));
        case "withdraw-response":
          return json(exercises.withdrawApprovedResponse(owner, action.command));
        case "cancel":
          return json(exercises.cancelTask(owner, action.command));
        case "short-step":
          return json(exercises.permitShortStep(owner, action.command, action.reason));
        case "pair":
          // Verify the owner/session relationship before creating any credential.
          if (!exercises.listOwnedSessions(owner).some(session => session.id === action.sessionId)) throw new LocalConnectionDenied();
          return json(auth.issue(action.sessionId, action.permission, principal =>
            exercises.setAccess(action.sessionId, owner, principal, action.permission)));
        case "revoke":
          auth.revoke(action.connectionId, (sessionId, principal) => exercises.setAccess(sessionId, owner, principal, "revoke"));
          return json({ revoked: true });
      }
    }
    const action = command(localConnectorCommandSchema, input);
    if (action.action === "redeem") return json(auth.redeem(action.code));
    const match = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("authorization") ?? "");
    if (!match) throw new LocalConnectionDenied();
    const sessionId = action.action === "turn" || action.action === "turn-receipt" ? action.command.sessionId : action.sessionId;
    const principal = auth.authenticateConnector(match[1], sessionId, action.action !== "state");
    switch (action.action) {
      case "state":
        return json(localConnectionStateSchema.parse(exercises.getState(sessionId, principal)));
      case "task":
        return json(exercises.getGenerationTask(sessionId, principal));
      case "turn":
        return json(exercises.submitTurn(principal, action.command, action.taskId, action.candidate));
      case "turn-receipt":
        return json(exercises.recoverTurnReceipt(principal, action.command, action.taskId, action.candidate));
    }
  } catch (error) {
    if (error instanceof ClaudeCliError) return json({ error: error.message }, 409);
    if (error instanceof LocalConnectionDenied) return json({ error: error.message }, 401);
    if (error instanceof LocalExerciseError) return json({ error: error.message, code: error.code, problems: error.problems }, 409);
    // Do not log request content, credentials, database rows or SQL error values.
    console.error("[local-connection] operation failed; check local storage and configuration");
    return json({ error: "The local operation failed. Check storage and configuration, then retry; do not assume it was saved." }, 500);
  }
}
