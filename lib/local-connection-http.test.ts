import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { LocalConnectionAuth, LocalConnectionDenied } from "@/lib/local-connection-auth";
import { LOCAL_SHORT_STEP_REASON, localConnectionStateSchema, localConnectionViewSchema } from "@/lib/local-connection-contracts";
import { handleLocalConnection, localConnectionOrigin } from "@/lib/local-connection-http";
import { localConnectionRoute } from "@/lib/local-connection-runtime";
import { LocalExerciseService } from "@/lib/local-exercise-service";

const origin = "http://127.0.0.1:3179";
const secret = () => randomBytes(32).toString("hex");
const receipt = z.object({ sessionId: z.string().uuid(), revision: z.number() });
const pairResult = z.object({ id: z.string().uuid(), code: z.string(), expiresAt: z.number() });
const redeemed = z.object({ token: z.string(), sessionId: z.string().uuid() });
const generatedTask = z.object({ id: z.string().uuid(), revision: z.number(), briefing: z.string() });
const initialTurn = {
  feedback: null, narrative_response: "The lights go out.", hours_elapsed: 0, time_elapsed: "Hour 0",
  new_inject: "Consider the stored supplies.", critical_alerts: [], suggested_actions: [],
  response_options: ["I check supplies.", "I contact someone.", "I wait."], scenario_status: "ongoing",
};
let directory: string;
let ownerCode: string;
let auth: LocalConnectionAuth;
let exercises: LocalExerciseService;
let cookie: string;
let now: number;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "readystate-connection-"));
  ownerCode = secret();
  now = Date.now();
  auth = new LocalConnectionAuth(join(directory, "auth.sqlite"), ownerCode, () => now);
  exercises = new LocalExerciseService(join(directory, "exercise.sqlite"));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Provider requests forbidden"); }));
  const unlocked = await browser({ action: "unlock", code: ownerCode }, "");
  expect(unlocked.status).toBe(200);
  cookie = unlocked.headers.get("set-cookie")!.split(";")[0];
});
afterEach(() => {
  auth.close(); exercises.close();
  rmSync(directory, { recursive: true });
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function request(body: unknown, client: "browser" | "connector", headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/${client === "browser" ? "local-connection" : "local-connector"}`, {
    method: "POST", headers: {
      Host: new URL(origin).host, "Content-Type": "application/json",
      ...(client === "browser" ? { Origin: origin, Cookie: cookie ?? "" } : {}), ...headers,
    }, body: JSON.stringify(body),
  });
}
const dispatch = (req: Request, client: "browser" | "connector") => handleLocalConnection(req, client, { origin, auth, exercises });
const browser = (body: unknown, value = cookie) => dispatch(request(body, "browser", { Cookie: value }), "browser");
const connector = (body: unknown, token = "") => dispatch(request(body, "connector", token ? { Authorization: `Bearer ${token}` } : {}), "connector");
async function session() {
  return receipt.parse(await (await browser({ action: "create", approval: { id: randomUUID(), text: "[Person 1] has stored water." } })).json());
}
async function pair(sessionId: string, permission: "read" | "write" = "write") {
  const issued = pairResult.parse(await (await browser({ action: "pair", sessionId, permission })).json());
  const connection = redeemed.parse(await (await connector({ action: "redeem", code: issued.code })).json());
  return { ...issued, ...connection };
}

describe("local browser / connector boundary", () => {
  it("uses a one-time owner code and an HttpOnly, SameSite scoped cookie", async () => {
    const denied = await browser({ action: "unlock", code: ownerCode }, "");
    expect(denied.status).toBe(401);
    const status = await browser({ action: "status" });
    expect(status.status).toBe(200);
    expect(status.headers.get("cache-control")).toContain("no-store");
    const anotherCode = secret();
    const another = new LocalConnectionAuth(join(directory, "fresh.sqlite"), anotherCode);
    try {
      const unlocked = await handleLocalConnection(request({ action: "unlock", code: anotherCode }, "browser"), "browser",
        { origin, auth: another, exercises });
      expect(unlocked.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Strict; Path=\/api\/local-connection; Max-Age=43200/);
    } finally { another.close(); }
    expect((await browser({ action: "status" }, "")).status).toBe(401);
  });

  it.each<Record<string, string>>([
    { Origin: "https://attacker.example" }, { Origin: "null" }, { Host: "attacker.example" },
    { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" },
  ])("rejects cross-origin / rebinding headers %j before operations", async headers => {
    const result = await dispatch(request({ action: "create", approval: { id: randomUUID(), text: "Should not save." } }, "browser", headers), "browser");
    expect(result.status).toBe(403);
    expect(exercises.listOwnedSessions(auth.owner)).toEqual([]);
    expect(result.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses browser requests without Origin and connector requests with cookies or Origin", async () => {
    const req = request({ action: "status" }, "browser");
    req.headers.delete("origin");
    expect((await dispatch(req, "browser")).status).toBe(403);
    expect((await dispatch(request({ action: "redeem", code: secret() }, "connector", { Origin: origin }), "connector")).status).toBe(403);
    expect((await dispatch(request({ action: "redeem", code: secret() }, "connector", { Cookie: cookie }), "connector")).status).toBe(403);
  });

  it("permits only explicit loopback HTTP configuration", () => {
    for (const value of ["https://example.com", "http://0.0.0.0:3000", "http://127.0.0.1:3000/path", "http://user@localhost:3000"]) {
      expect(() => localConnectionOrigin(value)).toThrow();
    }
    expect(localConnectionOrigin(origin)).toBe(origin);
  });

  it("supports Next-normalized internal loopback URLs while retaining exact Host and browser Origin checks", async () => {
    const original = request({ action: "status" }, "browser");
    const normalized = new Request(original.url.replace("127.0.0.1", "localhost"), original);
    expect((await dispatch(normalized, "browser")).status).toBe(200);
    const remote = new Request(original.url.replace("127.0.0.1", "example.com"), request({ action: "status" }, "browser"));
    expect((await dispatch(remote, "browser")).status).toBe(403);
    const wrongPort = new Request(original.url.replace("3179", "3180"), request({ action: "status" }, "browser"));
    expect((await dispatch(wrongPort, "browser")).status).toBe(403);
  });

  it("exchanges a short-lived single-use code for a scoped credential without storing either plaintext", async () => {
    const created = await session();
    const paired = await pair(created.sessionId);
    expect((await connector({ action: "redeem", code: paired.code })).status).toBe(401);
    expect((await connector({ action: "state", sessionId: created.sessionId }, paired.token)).status).toBe(200);
    expect((await connector({ action: "state", sessionId: randomUUID() }, paired.token)).status).toBe(401);
    const bytes = readFileSync(join(directory, "auth.sqlite")).toString("latin1");
    for (const value of [ownerCode, cookie.split("=")[1], paired.code, paired.token]) expect(bytes).not.toContain(value);
    expect((await browser({ action: "status" })).headers.get("set-cookie")).toBeNull();
  });

  it("expires pairing codes, connector credentials and owner sessions", async () => {
    const created = await session();
    const code = pairResult.parse(await (await browser({ action: "pair", sessionId: created.sessionId, permission: "write" })).json());
    now += 5 * 60 * 1000;
    expect((await connector({ action: "redeem", code: code.code })).status).toBe(401);
    const paired = await pair(created.sessionId);
    now += 30 * 24 * 60 * 60 * 1000;
    expect((await connector({ action: "state", sessionId: created.sessionId }, paired.token)).status).toBe(401);
    expect((await browser({ action: "status" })).status).toBe(401);
  });

  it("persists identity and consumed code across full close/reopen without resetting exercise data", async () => {
    const created = await session();
    const paired = await pair(created.sessionId);
    const owner = auth.owner;
    auth.close(); exercises.close();
    auth = new LocalConnectionAuth(join(directory, "auth.sqlite"), ownerCode, () => now);
    exercises = new LocalExerciseService(join(directory, "exercise.sqlite"));
    expect(auth.owner).toBe(owner);
    expect((await browser({ action: "unlock", code: ownerCode }, "")).status).toBe(401);
    expect((await connector({ action: "state", sessionId: created.sessionId }, paired.token)).status).toBe(200);
    expect(localConnectionViewSchema.parse(await (await browser({ action: "status" })).json()).sessions).toHaveLength(1);
  });

  it("supports new owner setup-code recovery without changing owner or saved session identity", async () => {
    const created = await session();
    auth.close();
    ownerCode = secret();
    auth = new LocalConnectionAuth(join(directory, "auth.sqlite"), ownerCode, () => now);
    const unlocked = await browser({ action: "unlock", code: ownerCode }, "");
    expect(unlocked.status).toBe(200);
    const newCookie = unlocked.headers.get("set-cookie")!.split(";")[0];
    expect((await browser({ action: "state", sessionId: created.sessionId }, newCookie)).status).toBe(200);
    expect((await browser({ action: "status" }, cookie)).status).toBe(401);
  });

  it("read-only access cannot issue tasks/submit turns and no connector can approve responses or grant connections", async () => {
    const created = await session();
    const paired = await pair(created.sessionId, "read");
    expect((await connector({ action: "state", sessionId: created.sessionId }, paired.token)).status).toBe(200);
    expect((await connector({ action: "task", sessionId: created.sessionId }, paired.token)).status).toBe(401);
    expect((await connector({ action: "response", command: { sessionId: created.sessionId, expectedRevision: 0, key: "not-owner" },
      approval: { id: randomUUID(), text: "Invented participant response" } }, paired.token)).status).toBe(409);
    expect((await connector({ action: "pair", sessionId: created.sessionId, permission: "write" }, paired.token)).status).toBe(409);
    expect((await browser({ action: "status" }, `readystate-local-owner=${paired.token}`)).status).toBe(401);
  });

  it("makes accepted connector turns visible to the browser and revokes immediately without deleting history", async () => {
    const created = await session();
    const paired = await pair(created.sessionId);
    const task = generatedTask.parse(await (await connector({ action: "task", sessionId: created.sessionId }, paired.token)).json());
    expect(task.briefing).toContain("[Person 1]");
    const submit = { action: "turn", command: { sessionId: created.sessionId, expectedRevision: task.revision, key: randomUUID() },
      taskId: task.id, candidate: initialTurn };
    expect((await connector(submit, paired.token)).status).toBe(200);
    const state = localConnectionStateSchema.parse(await (await browser({ action: "state", sessionId: created.sessionId })).json());
    expect(state.events[0].turn).toEqual(initialTurn);
    expect((await browser({ action: "revoke", connectionId: paired.id })).status).toBe(200);
    expect((await connector(submit, paired.token)).status).toBe(401);
    expect(localConnectionStateSchema.parse(await (await browser({ action: "state", sessionId: created.sessionId })).json()).events).toHaveLength(1);
  });

  it("denies revoked tokens even if cleanup failed, then permits explicit cleanup retry", async () => {
    const created = await session();
    const paired = await pair(created.sessionId);
    expect(() => auth.revoke(paired.id, () => { throw new Error("Synthetic cleanup failure"); })).toThrow("Synthetic cleanup failure");
    expect(() => auth.authenticateConnector(paired.token, created.sessionId, false)).toThrow(LocalConnectionDenied);
    expect((await browser({ action: "revoke", connectionId: paired.id })).status).toBe(200);
  });

  it("releases only the fixed owner-approved short-step reason, never arbitrary unreviewed free text", async () => {
    const created = await session();
    const paired = await pair(created.sessionId);
    const task = generatedTask.parse(await (await connector({ action: "task", sessionId: created.sessionId }, paired.token)).json());
    await connector({ action: "turn", command: { sessionId: created.sessionId, expectedRevision: task.revision, key: randomUUID() },
      taskId: task.id, candidate: initialTurn }, paired.token);
    await browser({ action: "response", command: { sessionId: created.sessionId, expectedRevision: 1, key: randomUUID() },
      approval: { id: randomUUID(), text: "Approved response." } });
    const command = { sessionId: created.sessionId, expectedRevision: 2, key: randomUUID() };
    expect((await browser({ action: "short-step", command, reason: "Synthetic unreviewed private name" })).status).toBe(409);
    expect((await connector({ action: "short-step", command, reason: LOCAL_SHORT_STEP_REASON }, paired.token)).status).toBe(409);
    expect((await browser({ action: "short-step", command, reason: LOCAL_SHORT_STEP_REASON })).status).toBe(200);
    const approvedTask = await (await connector({ action: "task", sessionId: created.sessionId }, paired.token)).json();
    expect(approvedTask.shortStepReason).toBe(LOCAL_SHORT_STEP_REASON);
  });

  it("requires JSON, bounds streaming bodies and never echoes request payload in failures", async () => {
    const noJson = request({ action: "status" }, "browser");
    noJson.headers.set("content-type", "text/plain");
    expect((await dispatch(noJson, "browser")).status).toBe(409);
    const large = await browser({ action: "create", approval: { id: randomUUID(), text: "SYNTHETIC-PRIVATE".repeat(12_000) } });
    expect(large.status).toBe(409);
    expect(await large.text()).not.toContain("SYNTHETIC-PRIVATE");
    const malformed = new Request(`${origin}/api/local-connection`, {
      method: "POST", headers: { Host: new URL(origin).host, Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: "{invalid",
    });
    expect((await dispatch(malformed, "browser")).status).toBe(409);
  });

  it("locks only the browser owner session, leaving separately authorized connector access explicit", async () => {
    const created = await session();
    const paired = await pair(created.sessionId);
    expect((await browser({ action: "lock" })).status).toBe(200);
    expect((await browser({ action: "status" })).status).toBe(401);
    expect((await connector({ action: "state", sessionId: created.sessionId }, paired.token)).status).toBe(200);
  });

  it.each([
    { READYSTATE_LOCAL_CONNECTIONS: "" },
    { READYSTATE_LOCAL_CONNECTIONS: "1", VERCEL: "1" },
    { READYSTATE_LOCAL_CONNECTIONS: "1", READYSTATE_MODE: "hosted" },
    { READYSTATE_LOCAL_CONNECTIONS: "1", READYSTATE_TRIAL_PASSWORD: "synthetic-trial-setting" },
  ])("fails closed outside opted-in local mode: %j", async env => {
    for (const name of ["READYSTATE_LOCAL_CONNECTIONS", "VERCEL", "READYSTATE_MODE", "READYSTATE_TRIAL_PASSWORD"]) vi.stubEnv(name, "");
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    expect((await localConnectionRoute(request({ action: "status" }, "browser"), "browser")).status).toBe(404);
  });

  it("refuses an incomplete data pair instead of creating a replacement owner identity", async () => {
    const incomplete = join(directory, "incomplete");
    mkdirSync(incomplete, { mode: 0o700 });
    const filename = join(incomplete, "exercises.sqlite");
    writeFileSync(filename, "synthetic-existing-exercise-data");
    for (const [name, value] of Object.entries({
      READYSTATE_LOCAL_CONNECTIONS: "1", READYSTATE_LOCAL_ORIGIN: origin,
      READYSTATE_LOCAL_DATA_DIR: incomplete, READYSTATE_LOCAL_OWNER_CODE: ownerCode,
      VERCEL: "", READYSTATE_MODE: "self-hosted", READYSTATE_TRIAL_PASSWORD: "",
    })) vi.stubEnv(name, value);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await localConnectionRoute(request({ action: "status" }, "browser"), "browser")).status).toBe(503);
      expect(existsSync(join(incomplete, "connection-credentials.sqlite"))).toBe(false);
      expect(readFileSync(filename, "utf8")).toBe("synthetic-existing-exercise-data");
      expect(log).toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});
