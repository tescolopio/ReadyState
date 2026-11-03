import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TurnOutput } from "@/lib/exercise-contracts";
import { validateExerciseTurn } from "@/lib/exercise-turn-validation";
import { privateTerms, leakedTerms } from "@/lib/household";
import { engineBaseline } from "@/lib/inventory";
import { LocalExerciseError, LocalExerciseService, type ExerciseErrorCode } from "@/lib/local-exercise-service";
import { localExerciseMessages } from "@/lib/local-exercise-view";
import { TEST_HOUSEHOLDS } from "@/lib/test-households";
import { buildExercisePrompt, deriveTtxState } from "@/lib/ttx";
import { usePrivacyStore } from "@/store/usePrivacyStore";
import { maskInput } from "@/utils/obfuscator";

const turn = (hour: number): TurnOutput => ({
  feedback: hour === 0 ? null : { covered: ["The recorded decision."], consider: [], why: "Keep supplies usable." },
  narrative_response: `Simulated outcome at Hour ${hour}.`,
  hours_elapsed: hour, time_elapsed: `Hour ${hour}`, new_inject: "Consider the next development.",
  critical_alerts: [], suggested_actions: [],
  response_options: hour === 72 ? [] : ["I check supplies.", "I contact someone.", "I wait."],
  scenario_status: hour === 72 ? "complete" : "ongoing",
});
const approval = (text = "Approved masked household. [Person 1] has water.") => ({ id: randomUUID(), text });
const refused = (run: () => unknown, code: ExerciseErrorCode) => {
  try { run(); } catch (error) {
    expect(error).toBeInstanceOf(LocalExerciseError);
    if (!(error instanceof LocalExerciseError)) throw error;
    expect(error.code).toBe(code);
    return error;
  }
  throw new Error(`Expected refusal: ${code}`);
};

let directory: string;
let filename: string;
let service: LocalExerciseService;
let owner: string;
let connector: string;
let sessionId: string;
let services: LocalExerciseService[];
let fixtures: DatabaseSync[];
const openFixture = () => {
  const fixture = new DatabaseSync(filename);
  fixtures.push(fixture);
  return fixture;
};
beforeEach(() => {
  fixtures = [];
  directory = mkdtempSync(join(tmpdir(), "readystate-session-"));
  filename = join(directory, "exercises.sqlite");
  service = new LocalExerciseService(filename);
  services = [service];
  owner = randomUUID();
  connector = randomUUID();
  sessionId = service.createApprovedSession(owner, approval()).sessionId;
  service.setAccess(sessionId, owner, connector, "write");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No model calls allowed"); }));
});
afterEach(() => {
  for (const fixture of fixtures) if (fixture.isOpen) fixture.close();
  for (const instance of services) instance.close();
  rmSync(directory, { recursive: true });
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
const command = (revision: number, key: string = randomUUID()) => ({ sessionId, expectedRevision: revision, key });
const initial = () => {
  const task = service.getGenerationTask(sessionId, connector);
  return service.submitTurn(connector, command(task.revision), task.id, turn(0));
};

describe("authoritative local exercise sessions", () => {
  it("publishes the final-step exception at Hour 68 and accepts completion without crisis authorization", () => {
    initial();
    for (const hour of [12, 24, 36, 48, 58, 68]) {
      const state = service.getState(sessionId, owner);
      service.submitApprovedResponse(owner, command(state.revision), approval());
      const task = service.getGenerationTask(sessionId, connector);
      service.submitTurn(connector, command(task.revision), task.id, turn(hour));
    }
    const state = service.getState(sessionId, owner);
    service.submitApprovedResponse(owner, command(state.revision), approval());
    const task = service.getGenerationTask(sessionId, connector);
    expect(task.clockPolicy.previousHour).toBe(68);
    expect(task.clockPolicy.allowShortFinalStep).toBe(true);
    expect(task.clockPolicy.shortStepReason).toBeUndefined();
    expect(task.instructions.phase).toContain("Local clock policy overrides the general advance rule");
    expect(task.instructions.phase).toContain("A shorter final step ending exactly at Hour 72 is always allowed without crisis authorization");
    service.submitTurn(connector, command(task.revision), task.id, turn(72));
    expect(service.getState(sessionId, owner).phase).toBe("ended");
  });

  it("recovers baseline, full accepted events, approvals and pending task from disk", () => {
    const accepted = initial();
    service.submitApprovedResponse(owner, command(accepted.revision), approval("I check the stored water."));
    const task = service.getGenerationTask(sessionId, connector);
    service.close();
    services = [];
    const second = new LocalExerciseService(filename);
    services.push(second);
    service = second;
    expect(second.getGenerationTask(sessionId, connector)).toEqual(task);
    const acceptedNext = second.submitTurn(connector, command(task.revision), task.id, turn(12));
    const state = service.getState(sessionId, owner);
    expect(state.revision).toBe(acceptedNext.revision);
    expect(state.events.map(event => event.turn.hours_elapsed)).toEqual([0, 12]);
    expect(state.events[1].response?.text).toBe("I check the stored water.");
    expect(state.baseline.text).toContain("[Person 1]");
  });

  it("makes approved-session creation retryable without replacing its snapshot", () => {
    const baseline = approval("  Approved masked text.\n");
    const created = service.createApprovedSession(owner, baseline);
    expect(service.createApprovedSession(owner, { text: baseline.text, id: baseline.id })).toEqual(created);
    refused(() => service.createApprovedSession(owner, { ...baseline, text: "Changed household." }), "idempotency-conflict");
    expect(service.getState(created.sessionId, owner).baseline).toEqual(baseline);
    const task = service.getGenerationTask(created.sessionId, owner);
    service.submitTurn(owner, { ...command(0), sessionId: created.sessionId }, task.id, turn(0));
    expect(service.createApprovedSession(owner, baseline)).toEqual(created);
  });

  it("requires a scoped grant and keeps owner-only approval/access operations unavailable to the connector", () => {
    const stranger = randomUUID();
    refused(() => service.getState(sessionId, stranger), "access");
    refused(() => service.getState(randomUUID(), stranger), "access");
    refused(() => service.getGenerationTask(sessionId, stranger), "access");
    refused(() => service.submitApprovedResponse(connector, command(0), approval()), "access");
    refused(() => service.setAccess(sessionId, connector, stranger, "write"), "access");
    refused(() => service.setAccess(sessionId, owner, owner, "revoke"), "access");
    service.setAccess(sessionId, owner, stranger, "read");
    expect(service.getState(sessionId, stranger).events).toEqual([]);
    refused(() => service.getGenerationTask(sessionId, stranger), "access");
    const task = service.getGenerationTask(sessionId, connector);
    refused(() => service.submitTurn(stranger, command(task.revision), task.id, turn(0)), "access");
  });

  it("revokes access immediately, invalidates released tasks and does not erase accepted history", () => {
    initial();
    const approved = service.submitApprovedResponse(owner, command(1), approval("I check water."));
    const task = service.getGenerationTask(sessionId, connector);
    service.setAccess(sessionId, owner, connector, "revoke");
    refused(() => service.getState(sessionId, connector), "access");
    refused(() => service.submitTurn(connector, command(approved.revision), task.id, turn(12)), "access");
    service.setAccess(sessionId, owner, connector, "write");
    const state = service.getState(sessionId, owner);
    expect(state.events).toHaveLength(1);
    refused(() => service.submitTurn(connector, command(state.revision), task.id, turn(12)), "stale-task");
  });

  it("replays the exact committed receipt after a lost acknowledgement, including across restart", () => {
    const task = service.getGenerationTask(sessionId, connector);
    const input = command(task.revision, "lost-ack");
    const accepted = service.submitTurn(connector, input, task.id, turn(0));
    const second = new LocalExerciseService(filename);
    services.push(second);
    expect(second.submitTurn(connector, input, task.id, turn(0))).toEqual(accepted);
    expect(second.getState(sessionId, connector).events).toHaveLength(1);
    refused(() => second.submitTurn(connector, input, task.id, { ...turn(0), new_inject: "Changed content." }), "idempotency-conflict");
  });

  it("fingerprints JSON content independently of object-key order and rejects changed revision/key reuse", () => {
    const task = service.getGenerationTask(sessionId, owner);
    const input = command(0, "stable-key");
    const candidate = turn(0);
    const receipt = service.submitTurn(owner, input, task.id, candidate);
    const reordered = Object.fromEntries(Object.entries(candidate).reverse());
    expect(service.submitTurn(owner, input, task.id, reordered)).toEqual(receipt);
    refused(() => service.submitTurn(owner, { ...input, expectedRevision: 1 }, task.id, candidate), "idempotency-conflict");
    refused(() => service.submitApprovedResponse(owner, { ...input, expectedRevision: 1 }, approval()), "idempotency-conflict");
  });

  it("rejects competing writers rather than overwriting the first accepted event", () => {
    const second = new LocalExerciseService(filename);
    services.push(second);
    const task = second.getGenerationTask(sessionId, connector);
    service.submitTurn(connector, command(0, "winner"), task.id, turn(0));
    refused(() => second.submitTurn(connector, command(0, "loser"), task.id, turn(0)), "stale-revision");
    expect(second.getState(sessionId, owner).events).toHaveLength(1);
  });

  it("does not commit invalid turns, consume their task or leak candidate text into errors", () => {
    const task = service.getGenerationTask(sessionId, connector);
    const before = service.getState(sessionId, owner);
    const error = refused(() => service.submitTurn(connector, command(0), task.id, {
      ...turn(0), feedback: { ...turn(12).feedback, why: "SYNTHETIC-PRIVATE-INPUT" },
    }), "invalid-turn");
    expect(JSON.stringify(error)).not.toContain("SYNTHETIC-PRIVATE-INPUT");
    expect(service.getState(sessionId, owner)).toEqual(before);
    expect(service.getGenerationTask(sessionId, connector)).toEqual(task);
    service.submitTurn(connector, command(0), task.id, turn(0));
  });

  it("rolls back both accepted event and receipt when storage fails mid-commit", () => {
    const task = service.getGenerationTask(sessionId, connector);
    const fixture = openFixture();
    fixture.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON exercise_receipts BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END");
    const before = service.getState(sessionId, owner);
    expect(() => service.submitTurn(connector, command(0, "atomic"), task.id, turn(0))).toThrow("fixture write failure");
    expect(service.getState(sessionId, owner)).toEqual(before);
    fixture.exec("DROP TRIGGER fail_receipt");
    fixture.close();
    expect(service.submitTurn(connector, command(0, "atomic"), task.id, turn(0)).revision).toBe(1);
  });

  it("retains pending approved responses when cancelling and refuses the cancelled task", () => {
    initial();
    const response = approval("I check water.");
    const responseResult = service.submitApprovedResponse(owner, command(1), response);
    const task = service.getGenerationTask(sessionId, connector);
    const cancelled = service.cancelTask(owner, command(responseResult.revision));
    const state = service.getState(sessionId, owner);
    expect(state.pendingResponse).toEqual(response);
    refused(() => service.submitTurn(connector, command(cancelled.revision), task.id, turn(12)), "stale-task");
    const nextTask = service.getGenerationTask(sessionId, connector);
    expect(nextTask.id).not.toBe(task.id);
    service.submitTurn(connector, command(nextTask.revision), nextTask.id, turn(12));
  });

  it("requires an actual approved response and forbids reusing approval references", () => {
    initial();
    refused(() => service.getGenerationTask(sessionId, connector), "wrong-phase");
    const response = approval("I check water.");
    const input = command(1, "approved-response");
    const receipt = service.submitApprovedResponse(owner, input, response);
    expect(service.submitApprovedResponse(owner, input, response)).toEqual(receipt);
    refused(() => service.submitApprovedResponse(owner, command(receipt.revision), approval()), "wrong-phase");
    const task = service.getGenerationTask(sessionId, connector);
    service.submitTurn(connector, command(task.revision), task.id, turn(12));
    refused(() => service.submitApprovedResponse(owner, command(task.revision + 1), response), "idempotency-conflict");
  });

  it("permits a short crisis step only after a local-owner decision and records its task rationale", () => {
    initial();
    service.submitApprovedResponse(owner, command(1), approval("I check the urgent situation."));
    let task = service.getGenerationTask(sessionId, connector);
    refused(() => service.submitTurn(connector, command(task.revision), task.id, turn(1)), "invalid-turn");
    const cancelled = service.cancelTask(owner, command(task.revision));
    refused(() => service.permitShortStep(connector, command(cancelled.revision), "Assistant assertion."), "access");
    service.permitShortStep(owner, command(cancelled.revision), "Review the urgent development before six hours.");
    task = service.getGenerationTask(sessionId, connector);
    expect(task.shortStepReason).toBe("Review the urgent development before six hours.");
    const accepted = service.submitTurn(connector, command(task.revision), task.id, turn(1));
    expect(service.getState(sessionId, owner).shortStepReason).toBeUndefined();
    expect(service.getState(sessionId, owner).events.at(-1)?.task.shortStepReason).toBe(task.shortStepReason);
    expect(accepted.revision).toBe(task.revision + 1);
  });

  it.each([[6.2, 12.2], [6.1, 18.1]])("accepts and reloads a fractional interval %s to %s", (first, next) => {
    initial();
    for (const hour of [first, next]) {
      const state = service.getState(sessionId, owner);
      service.submitApprovedResponse(owner, command(state.revision), approval("I check supplies."));
      const task = service.getGenerationTask(sessionId, connector);
      service.submitTurn(connector, command(task.revision), task.id, turn(hour));
    }
    const reopened = new LocalExerciseService(filename);
    services.push(reopened);
    expect(reopened.getState(sessionId, owner).events.map(event => event.turn.hours_elapsed)).toEqual([0, first, next]);
  });

  it.each(TEST_HOUSEHOLDS)("keeps $id full accepted log and UI adapter aligned without provider calls", ({ profile }) => {
    usePrivacyStore.getState().clearMappings();
    const baseline = engineBaseline(profile, text => maskInput(text, { alwaysMask: privateTerms(profile), dryRun: true }));
    sessionId = service.createApprovedSession(owner, approval(baseline)).sessionId;
    service.setAccess(sessionId, owner, connector, "write");
    for (const hour of [0, 12, 24, 36, 48, 60, 72]) {
      let state = service.getState(sessionId, owner);
      if (hour) service.submitApprovedResponse(owner, command(state.revision), approval(`Approved response for Hour ${hour - 12}.`));
      const task = service.getGenerationTask(sessionId, connector);
      expect(task.briefing).toBe(buildExercisePrompt(localExerciseMessages(service.getState(sessionId, owner))));
      service.submitTurn(connector, command(task.revision), task.id, turn(hour));
      state = service.getState(sessionId, owner);
      expect(leakedTerms(JSON.stringify(state), privateTerms(profile))).toEqual([]);
    }
    const state = service.getState(sessionId, owner);
    expect(state.events).toHaveLength(7);
    expect(state.events[0].turn.narrative_response).toBe(turn(0).narrative_response);
    expect(state.events[1].response?.text).toBe("Approved response for Hour 0.");
    expect(deriveTtxState(localExerciseMessages(state))).toMatchObject({ phase: "ended", hoursElapsed: 72 });
    refused(() => service.getGenerationTask(sessionId, connector), "wrong-phase");
    refused(() => service.submitApprovedResponse(owner, command(state.revision), approval()), "wrong-phase");
  });

  it.each(["promptVersion", "contextVersion", "schemaVersion", "acceptanceVersion", "contextHash"])(
    "binds tasks to %s and refuses outdated persisted tasks", field => {
    const task = service.getGenerationTask(sessionId, connector);
    const fixture = openFixture();
    fixture.prepare("UPDATE exercise_sessions SET state = json_set(state, ?, 'old') WHERE id = ?").run(`$.task.${field}`, sessionId);
    fixture.close();
    refused(() => service.getGenerationTask(sessionId, connector), "stale-task");
    refused(() => service.submitTurn(connector, command(task.revision), task.id, turn(0)), "stale-task");
    service.cancelTask(owner, command(task.revision));
    expect(service.getGenerationTask(sessionId, connector).promptVersion).toBe("1");
  });

  it("refuses corrupt storage without resetting or replacing it", () => {
    const fixture = openFixture();
    fixture.exec("DROP INDEX exercise_approved_baseline");
    fixture.prepare("UPDATE exercise_sessions SET state = ? WHERE id = ?").run("{broken", sessionId);
    refused(() => service.getState(sessionId, owner), "corrupt-storage");
    expect(fixture.prepare("SELECT state FROM exercise_sessions WHERE id = ?").get(sessionId)?.state).toBe("{broken");
    fixture.close();
  });

  it("refuses inconsistent persisted progression instead of inferring a replacement history", () => {
    initial();
    const fixture = openFixture();
    fixture.prepare("UPDATE exercise_sessions SET state = json_set(state, '$.phase', 'ended') WHERE id = ?").run(sessionId);
    refused(() => service.getState(sessionId, owner), "corrupt-storage");
    fixture.close();
  });

  it("refuses an unknown database version without modifying its contents", () => {
    const fixture = openFixture();
    fixture.exec("PRAGMA user_version = 999");
    refused(() => new LocalExerciseService(filename), "corrupt-storage");
    expect(fixture.prepare("PRAGMA user_version").get()?.user_version).toBe(999);
    expect(fixture.prepare("SELECT count(*) AS count FROM exercise_sessions").get()?.count).toBe(1);
    fixture.close();
  });

  it("does not recreate missing tables in an already initialized database", () => {
    const fixture = openFixture();
    fixture.exec("DROP TABLE exercise_receipts");
    refused(() => new LocalExerciseService(filename), "corrupt-storage");
    expect(fixture.prepare("SELECT name FROM sqlite_master WHERE name = 'exercise_receipts'").get()).toBeUndefined();
    fixture.close();
  });

  it("rejects excessive payloads and unrecognized approval/settings fields", () => {
    refused(() => service.createApprovedSession(owner, { ...approval(), apiKey: "not-an-approved-field" }), "invalid-input");
    const task = service.getGenerationTask(sessionId, connector);
    refused(() => service.submitTurn(connector, command(0), task.id, { ...turn(0), new_inject: "x".repeat(132_000) }), "invalid-input");
    refused(() => service.submitTurn(connector, command(0), task.id, { ...turn(0), apiKey: "not-an-approved-field" }), "invalid-turn");
  });

  it("refuses deeply nested unknown candidate fields before recursive fingerprinting", () => {
    const task = service.getGenerationTask(sessionId, connector);
    let nested: unknown = null;
    for (let index = 0; index < 2_000; index++) nested = { nested };
    const before = service.getState(sessionId, owner);
    refused(() => service.submitTurn(connector, command(0), task.id, { ...turn(0), nested }), "invalid-turn");
    expect(service.getState(sessionId, owner)).toEqual(before);
  });

  it.each(["session", "repeated", "future"])("refuses inconsistent %s revisions without mutations", kind => {
    initial();
    service.submitApprovedResponse(owner, command(1), approval("I check water."));
    const task = service.getGenerationTask(sessionId, connector);
    service.submitTurn(connector, command(task.revision), task.id, turn(12));
    const fixture = openFixture();
    const path = kind === "session" ? "$.revision" : "$.events[1].task.revision";
    fixture.prepare("UPDATE exercise_sessions SET state = json_set(state, ?, ?) WHERE id = ?")
      .run(path, kind === "future" ? 99 : 0, sessionId);
    const before = fixture.prepare("SELECT state FROM exercise_sessions WHERE id = ?").get(sessionId)?.state;
    refused(() => service.getState(sessionId, owner), "corrupt-storage");
    refused(() => service.submitApprovedResponse(owner, command(0), approval()), "corrupt-storage");
    expect(fixture.prepare("SELECT state FROM exercise_sessions WHERE id = ?").get(sessionId)?.state).toBe(before);
  });
});

describe("explicit exercise clock and shape policy", () => {
  it.each([
    ["negative", { ...turn(0), hours_elapsed: -1 }, null],
    ["non-finite", { ...turn(0), hours_elapsed: Infinity }, null],
    ["NaN", { ...turn(0), hours_elapsed: NaN }, null],
    ["initial not zero", turn(6), null],
    ["initial feedback", { ...turn(0), feedback: turn(6).feedback }, null],
    ["initial suggestions", { ...turn(0), suggested_actions: ["An action."] }, null],
    ["clock disagreement", { ...turn(6), time_elapsed: "Hour 12" }, 0],
    ["backwards", turn(6), 12],
    ["unchanged", turn(12), 12],
    ["too far", turn(24), 0],
    ["overshoot", turn(73), 66],
    ["early completion", { ...turn(12), scenario_status: "complete", response_options: [] }, 0],
    ["late ongoing", { ...turn(72), scenario_status: "ongoing" }, 60],
    ["completed options", { ...turn(72), response_options: ["A", "B", "C"] }, 60],
    ["missing options", { ...turn(12), response_options: ["Only one"] }, 0],
    ["excess suggestions", { ...turn(12), suggested_actions: ["A", "B", "C"] }, 0],
    ["missing feedback", { ...turn(12), feedback: null }, 0],
    ["after completion", turn(72), 72],
    ["unapproved short step", turn(1), 0],
    ["genuinely short fractional interval", turn(12.199999), 6.2],
    ["genuinely excessive fractional interval", turn(18.100001), 6.1],
    ["tiny target overshoot", turn(72.00000000000001), 66],
  ] as const)("rejects %s", (_name, candidate, previousHour) => {
    expect(validateExerciseTurn(candidate, { previousHour }).ok).toBe(false);
  });

  it.each([[6, 0], [12, 0], [72, 60], [72, 71], [72, 66.5], [12.2, 6.2], [18.1, 6.1]])("accepts Hour %s after Hour %s", (hour, previousHour) => {
    expect(validateExerciseTurn(turn(hour), { previousHour })).toEqual({ ok: true, turn: turn(hour) });
  });
});
