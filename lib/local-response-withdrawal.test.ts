import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LOCAL_SHORT_STEP_REASON } from "@/lib/local-connection-contracts";
import { LocalExerciseError, LocalExerciseService, type ExerciseErrorCode } from "@/lib/local-exercise-service";

const turn = (hour: number) => ({
  feedback: hour === 0 ? null : { covered: ["The recorded decision."], consider: [], why: "Keep supplies usable." },
  narrative_response: `Simulated outcome at Hour ${hour}.`,
  hours_elapsed: hour, time_elapsed: `Hour ${hour}`, new_inject: "Consider the stored supplies.",
  critical_alerts: [], suggested_actions: [],
  response_options: ["I check supplies.", "I contact someone.", "I wait."], scenario_status: "ongoing",
});
const approval = (text: string) => ({ id: randomUUID(), text });
const refused = (run: () => unknown, code: ExerciseErrorCode) => {
  expect(run).toThrow(expect.objectContaining({ name: "LocalExerciseError", code }));
};

let service: LocalExerciseService;
let owner: string;
let connector: string;
let sessionId: string;
const command = (expectedRevision: number, key = randomUUID()) => ({ sessionId, expectedRevision, key });
const acceptBaseline = () => {
  const task = service.getGenerationTask(sessionId, connector);
  service.submitTurn(connector, command(0), task.id, turn(0));
};

beforeEach(() => {
  service = new LocalExerciseService(":memory:");
  owner = randomUUID();
  connector = randomUUID();
  sessionId = service.createApprovedSession(owner, approval("Reviewed household.")).sessionId;
  service.setAccess(sessionId, owner, connector, "write");
});
afterEach(() => service.close());

describe("owner-approved response withdrawal", () => {
  it.each([false, true])("withdraws atomically with an outstanding task: %s", released => {
    acceptBaseline();
    service.submitApprovedResponse(owner, command(1), approval("I check supplies."));
    service.permitShortStep(owner, command(2), LOCAL_SHORT_STEP_REASON);
    const task = released ? service.getGenerationTask(sessionId, connector) : undefined;
    const before = service.getState(sessionId, owner);
    const withdrawal = command(3);
    const result = service.withdrawApprovedResponse(owner, withdrawal);
    expect(result).toEqual({ sessionId, revision: 4 });
    const state = service.getState(sessionId, owner);
    expect(state.revision).toBe(4);
    expect(state.pendingResponse).toBeUndefined();
    expect(state.task).toBeUndefined();
    expect(state.shortStepReason).toBeUndefined();
    expect(state.events).toEqual(before.events);
    expect(state.baseline).toEqual(before.baseline);
    expect(state.phase).toBe("loop");
    refused(() => service.getGenerationTask(sessionId, connector), "wrong-phase");
    expect(service.withdrawApprovedResponse(owner, withdrawal)).toEqual(result);
    refused(() => service.withdrawApprovedResponse(owner, { ...withdrawal, key: randomUUID() }), "stale-revision");
    refused(() => service.withdrawApprovedResponse(owner, { ...withdrawal, expectedRevision: 4 }), "idempotency-conflict");
    if (task) {
      refused(() => service.submitTurn(connector, command(3), task.id, turn(6)), "stale-revision");
      refused(() => service.submitTurn(connector, command(4), task.id, turn(6)), "stale-task");
    }

    const reviewed = approval("I contact someone instead.");
    service.submitApprovedResponse(owner, command(4), reviewed);
    // A replay of the old withdrawal must not remove a newly reviewed response.
    expect(service.withdrawApprovedResponse(owner, withdrawal)).toEqual(result);
    expect(service.getState(sessionId, owner).pendingResponse).toEqual(reviewed);
    const replacement = service.getGenerationTask(sessionId, connector);
    expect(replacement.shortStepReason).toBeUndefined();
    if (task) {
      expect(replacement.id).not.toBe(task.id);
      refused(() => service.submitTurn(connector, command(5), task.id, turn(6)), "stale-task");
    }
    service.submitTurn(connector, command(5), replacement.id, turn(6));
    const accepted = service.getState(sessionId, owner);
    expect(accepted.events).toHaveLength(2);
    expect(accepted.events[1].response).toEqual(reviewed);
    expect(accepted.events[0]).toEqual(before.events[0]);
  });

  it("denies connectors and strangers, including duplicate receipt replay", () => {
    acceptBaseline();
    service.submitApprovedResponse(owner, command(1), approval("I check supplies."));
    const withdrawal = command(2);
    for (const principal of [connector, randomUUID()]) {
      refused(() => service.withdrawApprovedResponse(principal, withdrawal), "access");
      refused(() => service.submitApprovedResponse(principal, command(2), approval("Unreviewed.")), "access");
    }
    expect(service.getState(sessionId, owner).revision).toBe(2);
    service.withdrawApprovedResponse(owner, withdrawal);
    refused(() => service.withdrawApprovedResponse(connector, withdrawal), "access");
  });

  it("refuses an absent response or stale revision without changing state", () => {
    const baseline = service.getState(sessionId, owner);
    refused(() => service.withdrawApprovedResponse(owner, command(0)), "wrong-phase");
    expect(service.getState(sessionId, owner)).toEqual(baseline);
    acceptBaseline();
    const waiting = service.getState(sessionId, owner);
    refused(() => service.withdrawApprovedResponse(owner, command(1)), "wrong-phase");
    expect(service.getState(sessionId, owner)).toEqual(waiting);
    service.submitApprovedResponse(owner, command(1), approval("I check supplies."));
    const approved = service.getState(sessionId, owner);
    refused(() => service.withdrawApprovedResponse(owner, command(1)), "stale-revision");
    expect(service.getState(sessionId, owner)).toEqual(approved);
    expect(() => service.withdrawApprovedResponse(owner, { ...command(2), unexpected: true } as never))
      .toThrow(LocalExerciseError);
  });
});
