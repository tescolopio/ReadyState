import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { DIAGNOSTIC_BASELINE, diagnosticTurn, diagnosticSubmissionSchema, diagnosticReceiptSchema } from "@/lib/connection-diagnostic.mjs";
import { LocalConnectionAuth } from "@/lib/local-connection-auth";
import { handleLocalConnection } from "@/lib/local-connection-http";
import { LocalExerciseService } from "@/lib/local-exercise-service";
import { createDiagnosticClient, diagnosticConfig } from "./diagnostic-client.mjs";
import { createDiagnosticServer } from "./diagnostic.mjs";

let directory: string;
let auth: LocalConnectionAuth;
let exercises: LocalExerciseService;
let sessionId: string;
let token: string;
let origin: string;
let principal: string;
let now: number;
const secret = () => randomBytes(32).toString("hex");
const signal = () => new AbortController().signal;
const submission = z.object({ taskId: z.string().uuid(), expectedRevision: z.number(), candidate: z.unknown() });

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "readystate-diagnostic-"));
  auth = new LocalConnectionAuth(path.join(directory, "auth.sqlite"), secret(), () => now);
  exercises = new LocalExerciseService(path.join(directory, "exercises.sqlite"));
  sessionId = exercises.createApprovedSession(auth.owner, { id: randomUUID(), text: DIAGNOSTIC_BASELINE }).sessionId;
  now = Date.now();
  origin = "http://localhost:3000";
  token = pair();
});
afterEach(() => {
  auth.close();
  exercises.close();
  rmSync(directory, { recursive: true });
});
function pair(permission: "read" | "write" = "write", id = sessionId) {
  const issued = auth.issue(id, permission, next => {
    principal = next;
    exercises.setAccess(id, auth.owner, next, permission);
  });
  return auth.redeem(issued.code).token;
}
const dispatch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  request.headers.set("host", new URL(origin).host);
  return handleLocalConnection(request, "connector", { origin, auth, exercises });
};
const client = (request = dispatch, credential = token) => createDiagnosticClient(
  diagnosticConfig({ origin, sessionId, token: credential }), request,
);
const args = (task: { id: string; revision: number }) => ({
  taskId: task.id, expectedRevision: task.revision, candidate: diagnosticTurn,
});

describe("isolated fictional diagnostic connector", () => {
  it("creates a fresh MCP server per transport", async () => {
    const first = createDiagnosticServer(client());
    const second = createDiagnosticServer(client());
    expect(first).not.toBe(second);
    await first.close();
    await second.close();
  });
  it("retrieves a task, validates, saves and reopens exactly one accepted diagnostic", async () => {
    const bridge = client();
    expect(await bridge.status(signal())).toMatchObject({ diagnostic: "awaiting-acknowledgement", modelEvidence: "unavailable" });
    const task = await bridge.task(signal());
    const saved = await bridge.submit(args(task), signal());
    expect(saved).toMatchObject({ sessionId, saved: true });
    expect(await bridge.submit(args(task), signal())).toEqual(saved);
    exercises.close();
    exercises = new LocalExerciseService(path.join(directory, "exercises.sqlite"));
    expect(exercises.getState(sessionId, auth.owner).events).toHaveLength(1);
    expect(await bridge.status(signal())).toMatchObject({ diagnostic: "accepted" });
    await expect(bridge.task(signal())).rejects.toThrow("already saved");
  });
  it("recovers a committed lost acknowledgement without a duplicate write", async () => {
    let loseAck = true;
    let originalReceipt: unknown;
    const request: typeof fetch = async (input, init) => {
      const response = await dispatch(input, init);
      if (JSON.parse(String(init?.body)).action === "turn" && loseAck) {
        loseAck = false;
        originalReceipt = await response.json();
        throw new Error("Synthetic lost acknowledgement");
      }
      return response;
    };
    const bridge = client(request);
    const task = await bridge.task(signal());
    await expect(bridge.submit(args(task), signal())).rejects.toThrow("inspect saved state");
    expect(await client().status(signal())).toMatchObject({ diagnostic: "accepted" });
    exercises.close();
    exercises = new LocalExerciseService(path.join(directory, "exercises.sqlite"));
    auth.revoke(auth.list()[0].id, (id, value) => exercises.setAccess(id, auth.owner, value, "revoke"));
    const issued = auth.issue(sessionId, "write", value => exercises.setAccess(sessionId, auth.owner, value, "write"));
    const restarted = createDiagnosticClient(diagnosticConfig({ origin, sessionId, pairingCode: issued.code }), dispatch);
    const recovered = await restarted.submit(args(task), signal());
    expect(recovered).toMatchObject(diagnosticReceiptSchema.parse(originalReceipt));
    expect(await restarted.submit(args(task), signal())).toEqual(recovered);
    for (const altered of [
      { ...args(task), taskId: randomUUID() },
      { ...args(task), expectedRevision: task.revision + 1 },
    ]) await expect(restarted.submit(altered, signal())).rejects.toThrow("refused");
    await expect(client(dispatch, pair("read")).submit(args(task), signal())).rejects.toThrow("lacks permission");
    expect(exercises.getState(sessionId, auth.owner).events).toHaveLength(1);
  });
  it("rejects incorrect output before a network request or write", async () => {
    const request = vi.fn(dispatch);
    await expect(client(request).submit({ ...args({ id: randomUUID(), revision: 1 }), candidate: { ...diagnosticTurn, hours_elapsed: 6 } }, signal())).rejects.toThrow("Invalid diagnostic output");
    expect(request).not.toHaveBeenCalled();
    expect(exercises.getState(sessionId, auth.owner).events).toHaveLength(0);
    expect(diagnosticSubmissionSchema.safeParse({ ...args({ id: randomUUID(), revision: 1 }), model: "invented" }).success).toBe(false);
  });
  it("refuses household sessions without exposing their content", async () => {
    sessionId = exercises.createApprovedSession(auth.owner, { id: randomUUID(), text: "PRIVATE HOUSEHOLD CONTENT" }).sessionId;
    token = pair();
    const bridge = client();
    for (const work of [() => bridge.status(signal()), () => bridge.task(signal()), () => bridge.submit(args({ id: randomUUID(), revision: 1 }), signal())]) {
      await expect(work()).rejects.toThrow("not a fixed ReadyState diagnostic session");
    }
    expect(exercises.getState(sessionId, auth.owner).events).toHaveLength(0);
  });
  it("supports read-only status but explicitly denies requesting a write task", async () => {
    const bridge = client(dispatch, pair("read"));
    expect(await bridge.status(signal())).toMatchObject({ bridge: "connected" });
    await expect(bridge.task(signal())).rejects.toThrow("lacks permission");
  });
  it("refuses expired, revoked and wrong-session credentials explicitly", async () => {
    const bridge = client();
    now += 31 * 24 * 60 * 60 * 1000;
    await expect(bridge.status(signal())).rejects.toThrow("expired");
    now = Date.now();
    const connection = auth.list()[0];
    auth.revoke(connection.id, (id, value) => exercises.setAccess(id, auth.owner, value, "revoke"));
    await expect(bridge.status(signal())).rejects.toThrow("revoked");
    const another = exercises.createApprovedSession(auth.owner, { id: randomUUID(), text: DIAGNOSTIC_BASELINE }).sessionId;
    await expect(client(dispatch, pair("write", another)).status(signal())).rejects.toThrow("another session");
  });
  it("rejects cancelled stale tasks and accepts the fresh task", async () => {
    const bridge = client();
    const stale = await bridge.task(signal());
    exercises.cancelTask(auth.owner, { sessionId, expectedRevision: stale.revision, key: randomUUID() });
    await expect(bridge.submit(args(stale), signal())).rejects.toThrow("refused");
    const current = await bridge.task(signal());
    expect(current.id).not.toBe(stale.id);
    await bridge.submit(args(current), signal());
    expect(exercises.getState(sessionId, principal).events).toHaveLength(1);
  });
  it("redeems privately once, and requires fresh configuration after restart", async () => {
    const issued = auth.issue(sessionId, "write", value => exercises.setAccess(sessionId, auth.owner, value, "write"));
    const config = diagnosticConfig({ origin, sessionId, pairingCode: issued.code });
    const request = vi.fn(dispatch);
    const bridge = createDiagnosticClient(config, request);
    await Promise.all([bridge.status(signal()), bridge.status(signal())]);
    expect(request.mock.calls.filter(([, init]) => JSON.parse(String(init?.body)).action === "redeem")).toHaveLength(1);
    await expect(createDiagnosticClient(config, dispatch).status(signal())).rejects.toThrow("fresh code");
    expect(JSON.stringify(await bridge.status(signal()))).not.toContain(issued.code);
  });
  it("does not automatically repeat an uncertain one-use redemption", async () => {
    const issued = auth.issue(sessionId, "write", value => exercises.setAccess(sessionId, auth.owner, value, "write"));
    const request = vi.fn<typeof fetch>(async (input, init) => {
      await dispatch(input, init);
      throw new Error("Synthetic lost redemption response");
    });
    const bridge = createDiagnosticClient(diagnosticConfig({ origin, sessionId, pairingCode: issued.code }), request);
    await expect(bridge.status(signal())).rejects.toThrow("Pairing could not be confirmed");
    await expect(bridge.status(signal())).rejects.toThrow("fresh code");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("refuses unsafe origins and ambiguous/missing credentials without revealing values", () => {
    for (const value of ["https://service.example", "http://0.0.0.0:3000", "http://localhost:3000/path", "http://user:password@localhost:3000"]) {
      expect(() => diagnosticConfig({ origin: value, sessionId, token })).toThrow("exact HTTP loopback");
    }
    expect(() => diagnosticConfig({ origin, sessionId, token, pairingCode: secret() })).toThrow();
    expect(() => diagnosticConfig({ origin, sessionId })).toThrow();
  });
  it("surfaces disconnection, origin denial, bad JSON and redirects without secret-bearing errors", async () => {
    const broken: typeof fetch = async () => { throw new Error(`Sensitive raw error ${token}`); };
    await expect(client(broken).status(signal())).rejects.toThrow("disconnected");
    for (const [response, expected] of [
      [new Response("", { status: 403 }), "exact local origin"],
      [new Response("invalid"), "invalid diagnostic JSON"],
      [new Response("", { status: 503 }), "configuration/storage"],
    ] as const) {
      await expect(client(async () => response).status(signal())).rejects.toThrow(expected);
    }
    const request = vi.fn(dispatch);
    await client(request).status(signal());
    expect(request.mock.calls[0][1]).toMatchObject({ redirect: "error", credentials: "omit" });
    expect(new Headers(request.mock.calls[0][1]?.headers).has("cookie")).toBe(false);
  });
  it("bounds returned bytes and propagates cancellation without an automatic retry", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(150_001)); },
      cancel() { cancelled = true; },
    });
    await expect(client(async () => new Response(body)).status(signal())).rejects.toThrow("oversized");
    expect(cancelled).toBe(true);
    const controller = new AbortController();
    controller.abort();
    const request = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.signal?.aborted).toBe(true);
      throw new DOMException("Synthetic cancellation", "AbortError");
    });
    await expect(client(request).status(controller.signal)).rejects.toThrow("cancelled");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("discovers and calls real stdio MCP tools, then reconnects without losing accepted state", async () => {
    const server = createServer((req, res) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const response = await handleLocalConnection(new Request(`${origin}/api/local-connector`, {
          method: "POST", headers: { Host: new URL(origin).host, "Content-Type": "application/json", Authorization: req.headers.authorization ?? "" },
          body: Buffer.concat(chunks).toString("utf8"),
        }), "connector", { origin, auth, exercises });
        res.writeHead(response.status, { "Content-Type": "application/json" });
        res.end(await response.text());
      })().catch(() => { res.writeHead(500); res.end(); });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No diagnostic test address");
    origin = `http://127.0.0.1:${address.port}`;
    async function connect() {
      const transport = new StdioClientTransport({
        command: process.execPath, args: [path.resolve("scripts/claude/diagnostic.mjs")],
        env: {
          READYSTATE_CONNECTOR_ORIGIN: origin, READYSTATE_CONNECTOR_SESSION_ID: sessionId,
          READYSTATE_CONNECTOR_TOKEN: token,
        },
        stderr: "pipe",
      });
      const mcp = new Client({ name: "readystate-qualification-fixture", version: "1.0.0" });
      await mcp.connect(transport);
      return mcp;
    }
    let mcp: Client | undefined;
    try {
      mcp = await connect();
      expect((await mcp.listTools()).tools.map(tool => tool.name)).toEqual([
        "readystate_connection_status", "readystate_get_diagnostic", "readystate_submit_diagnostic",
      ]);
      const taskResult = await mcp.callTool({ name: "readystate_get_diagnostic", arguments: {} });
      const task = submission.parse(taskResult.structuredContent);
      const invalid = await mcp.callTool({ name: "readystate_submit_diagnostic", arguments: { ...task, candidate: { ...diagnosticTurn, narrative_response: "Wrong acknowledgement" } } });
      expect(invalid.isError).toBe(true);
      expect(exercises.getState(sessionId, auth.owner).events).toHaveLength(0);
      const saved = await mcp.callTool({ name: "readystate_submit_diagnostic", arguments: task });
      expect(saved.isError).not.toBe(true);
      expect(saved.structuredContent).toMatchObject({ sessionId, saved: true, modelEvidence: "unavailable" });
      expect((await mcp.callTool({ name: "readystate_submit_diagnostic", arguments: task })).structuredContent).toEqual(saved.structuredContent);
      await mcp.close();
      mcp = await connect();
      expect((await mcp.callTool({ name: "readystate_connection_status", arguments: {} })).structuredContent).toMatchObject({ diagnostic: "accepted", modelEvidence: "unavailable" });
      expect(exercises.getState(sessionId, auth.owner).events).toHaveLength(1);
      auth.revoke(auth.list()[0].id, (id, value) => exercises.setAccess(id, auth.owner, value, "revoke"));
      const denied = await mcp.callTool({ name: "readystate_connection_status", arguments: {} });
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied)).not.toContain(token);
      await mcp.close();
      token = pair();
      mcp = await connect();
      expect((await mcp.callTool({ name: "readystate_connection_status", arguments: {} })).structuredContent).toMatchObject({ diagnostic: "accepted" });
      expect(exercises.getState(sessionId, auth.owner).events).toHaveLength(1);
    } finally {
      await mcp?.close();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }, 20_000);
});
