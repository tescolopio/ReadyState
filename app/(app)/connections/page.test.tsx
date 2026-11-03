// @vitest-environment jsdom
import { randomUUID } from "node:crypto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ConnectionsPage from "@/app/(app)/connections/page";
import { DIAGNOSTIC_BASELINE } from "@/lib/connection-diagnostic.mjs";
import { loadLocalSessionPrivacy, LOCAL_PRIVACY_SETTINGS_KEY, newLocalSessionPrivacy, saveLocalPrivacySettings, saveLocalSessionPrivacy } from "@/lib/local-session-privacy";
import type { LocalConnectionState } from "@/lib/local-connection-contracts";
import { usePrivacyStore } from "@/store/usePrivacyStore";

let container: HTMLDivElement;
let root: Root;
let saved: LocalConnectionState;
let writes: string[];
let requests: unknown[];
let responseFailure: "uncommitted" | "committed" | undefined;
let stateWait: Promise<void> | undefined;
let stateWaitBySession: Map<string, Promise<void>>;
let stateWaitQueue: Map<string, Promise<void>[]>;
let onStateRequest: ((id: string) => void) | undefined;
let fixtureEvent: LocalConnectionState["events"][number];
let otherSaved: LocalConnectionState;
const sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const baselineId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherSessionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const otherBaselineId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  usePrivacyStore.setState({ alwaysMask: [], entityMap: {} });
  fixtureEvent = {
    id: randomUUID(),
    turn: {
      feedback: null, narrative_response: "Fixture event.", hours_elapsed: 0, time_elapsed: "Hour 0",
      new_inject: "Fixture only.", critical_alerts: [], suggested_actions: [],
      response_options: ["Check.", "Wait.", "Ask."], scenario_status: "ongoing",
    },
  };
  saved = {
    id: sessionId, revision: 1, phase: "loop",
    baseline: { id: baselineId, text: "Approved fictional household." },
    events: [fixtureEvent],
  };
  otherSaved = {
    ...saved, id: otherSessionId,
    baseline: { id: otherBaselineId, text: "Other fictional session." },
  };
  saveLocalSessionPrivacy(localStorage, sessionId, newLocalSessionPrivacy(baselineId, ["originalprivateterm"]));
  writes = [];
  requests = [];
  responseFailure = undefined;
  stateWait = undefined;
  stateWaitBySession = new Map();
  stateWaitQueue = new Map();
  onStateRequest = undefined;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    if (body.action === "status") return Response.json({
      sessions: [saved, otherSaved].map(state => ({ id: state.id, revision: state.revision, phase: state.phase })),
      connections: [],
    });
    if (body.action === "state") {
      const id = String(body.sessionId);
      onStateRequest?.(id);
      const state = structuredClone(id === sessionId ? saved : otherSaved);
      const wait = stateWaitQueue.get(id)?.shift() ?? stateWaitBySession.get(id) ?? stateWait;
      await wait;
      return Response.json(state);
    }
    if (body.action === "lock") return Response.json({ locked: true });
    if (body.action === "claude-status") {
      return Response.json({ installed: true, version: "2.1.300", authentication: "native-subscription", evaluationEnabled: true });
    }
    if (body.action === "claude-diagnostic") {
      saved = {
        ...saved,
        events: [{ ...fixtureEvent, turn: { ...fixtureEvent.turn, narrative_response: "Diagnostic result." } }],
      };
      return Response.json(saved);
    if (body.action === "create") {
      writes.push(body.approval.text);
      if (responseFailure === "uncommitted") throw new Error("Fixture lost request");
      saved = { ...saved, baseline: body.approval, revision: saved.revision + 1 };
      if (responseFailure === "committed") throw new Error("Fixture lost acknowledgement");
      return Response.json({ sessionId, revision: saved.revision });
    }
    if (body.action === "response") {
      writes.push(body.approval.text);
      if (responseFailure === "uncommitted") throw new Error("Fixture lost request");
      saved = { ...saved, revision: saved.revision + 1, pendingResponse: body.approval };
      if (responseFailure === "committed") throw new Error("Fixture lost acknowledgement");
      return Response.json({ sessionId, revision: saved.revision });
    }
    throw new Error("Unexpected request");
  }));
  vi.stubGlobal("navigator", {
    locks: { request: (_name: string, _options: LockOptions, callback: LockGrantedCallback<unknown>) => Promise.resolve(callback(null)) },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => { button.click(); });
}
async function start(text: string) {
  await act(async () => root.render(<ConnectionsPage />));
  await click(`Resume ${sessionId.slice(0, 8)} · loop`);
  const input = container.querySelector<HTMLTextAreaElement>("#local-response")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Review response");
}
async function startDiagnostic() {
  saved = { ...saved, baseline: { ...saved.baseline, text: DIAGNOSTIC_BASELINE }, events: [] };
  await act(async () => root.render(<ConnectionsPage />));
  await click(`Resume ${sessionId.slice(0, 8)} · loop`);
  await click("Check installed Claude and sign-in");
}
async function waitForText(text: string) {
  for (let attempt = 0; attempt < 30 && !container.textContent?.includes(text); attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }
  expect(container.textContent).toContain(text);
}

describe("local connection send-time privacy", () => {
  it("shows incompatibility instead of diagnostic success for an ordinary connector event", async () => {
    saved = {
      ...saved,
      baseline: { id: baselineId, text: DIAGNOSTIC_BASELINE },
    };
    saveLocalSessionPrivacy(localStorage, sessionId, newLocalSessionPrivacy(baselineId, []));
    await act(async () => root.render(<ConnectionsPage />));
    await click(`Resume ${sessionId.slice(0, 8)} · loop`);
    expect(container.textContent).toContain("This session is incompatible with the ReadyState diagnostic protocol.");
    expect(container.textContent).not.toContain("Diagnostic acknowledgement saved");
    expect(container.textContent).not.toContain("Accepted simulated event");
  });

  it("does not send when shared Settings storage is corrupt", async () => {
    await start("the codeword is quietorchid");
    localStorage.setItem(LOCAL_PRIVACY_SETTINGS_KEY, '{"invalid":true}');
    await click("Send this");
    expect(writes).toEqual([]);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("does not blindly retry a briefing after another tab restricts its approved text", async () => {
    await act(async () => root.render(<ConnectionsPage />));
    await click("Review new household briefing");
    const preview = container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(preview, "the codeword is quietorchid");
      preview.dispatchEvent(new Event("input", { bubbles: true }));
    });
    responseFailure = "uncommitted";
    await click("Send this");
    expect(writes).toEqual(["the codeword is quietorchid"]);
    await saveLocalPrivacySettings(localStorage, ["quietorchid"]);
    responseFailure = undefined;
    await click("Retry approved save");
    expect(writes).toHaveLength(1);
    expect(container.textContent).toContain("Nothing was retransmitted");
    expect(container.querySelector('[aria-label="Unconfirmed save"]')).not.toBeNull();
  });

  it("still retries the fixed fictional diagnostic without a household privacy review", async () => {
    await act(async () => root.render(<ConnectionsPage />));
    responseFailure = "uncommitted";
    await click("Create fictional connection diagnostic");
    expect(writes).toHaveLength(1);
    responseFailure = undefined;
    await click("Retry approved save");
    expect(writes).toHaveLength(2);
    expect(writes[1]).toBe(writes[0]);
  });

  it.each(["approval", "retry"])("does not send data newly restricted by another tab's Settings before %s", async stage => {
    await start("the codeword is quietorchid");
    if (stage === "retry") {
      responseFailure = "uncommitted";
      await click("Send this");
      responseFailure = undefined;
    }
    // Another tab saves shared Settings without touching this tab's in-memory store.
    await saveLocalPrivacySettings(localStorage, ["quietorchid"]);
    expect(usePrivacyStore.getState().alwaysMask).toEqual([]);
    const previousWrites = writes.length;
    await click(stage === "retry" ? "Retry approved save" : "Send this");
    expect(writes).toHaveLength(previousWrites);
    const preview = container.querySelector<HTMLTextAreaElement>('textarea:not(#local-response)')!;
    expect(preview.value).not.toContain("quietorchid");
    await click("Send this");
    expect(writes).toHaveLength(previousWrites + 1);
    expect(writes.at(-1)).not.toContain("quietorchid");
  });
  it("uses newly added Settings rules and requires another review when they change", async () => {
    usePrivacyStore.getState().setAlwaysMask(["firstprivateword"]);
    await start("firstprivateword and secondprivateword with originalprivateterm");
    const preview = () => container.querySelector<HTMLTextAreaElement>('textarea:not(#local-response)')!;
    expect(preview().value).not.toContain("firstprivateword");
    expect(preview().value).not.toContain("originalprivateterm");
    await act(async () => usePrivacyStore.getState().setAlwaysMask(["secondprivateword"]));
    await click("Send this");
    expect(writes).toEqual([]);
    expect(preview().value).not.toContain("secondprivateword");
    await click("Send this");
    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toContain("secondprivateword");
    expect(writes[0]).not.toContain("originalprivateterm");
  });
  it("keeps a selected raw phrase in memory until Send and does not change global rules", async () => {
    await start("the codeword is quietorchid");
    const preview = container.querySelector<HTMLTextAreaElement>('textarea:not(#local-response)')!;
    const selectionStart = preview.value.indexOf("quietorchid");
    expect(selectionStart).toBeGreaterThanOrEqual(0);
    preview.setSelectionRange(selectionStart, selectionStart + "quietorchid".length);
    await click("Mask selected text");
    expect(container.textContent).toContain("this session only");
    await click("Mask it");
    expect(JSON.stringify({ ...localStorage })).not.toContain("quietorchid");
    expect(usePrivacyStore.getState().alwaysMask).toEqual([]);
    await click("Back, don't send");
    expect(writes).toEqual([]);
    expect(JSON.stringify({ ...localStorage })).not.toContain("quietorchid");
  });
  it("refuses a stale server revision before persisting a new mapping or sending", async () => {
    await start("my sister Alice called");
    const before = localStorage.getItem(`readystate.local-session-privacy.v1.session.${sessionId}`);
    saved = { ...saved, revision: 2, pendingResponse: { id: randomUUID(), text: "Approved in another tab." } };
    await click("Send this");
    expect(writes).toEqual([]);
    expect(localStorage.getItem(`readystate.local-session-privacy.v1.session.${sessionId}`)).toBe(before);
    expect(container.textContent).toContain("Approved in another tab.");
    expect(requests).not.toContainEqual(expect.objectContaining({ action: "response" }));
  });
  it.each(["session", "Settings"])("rechecks %s rules under the lock before retransmitting an uncommitted response", async source => {
    await start("the codeword is quietorchid");
    responseFailure = "uncommitted";
    await click("Send this");
    expect(writes).toEqual(["the codeword is quietorchid"]);
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const lock = vi.fn(async (_name: string, _options: LockOptions, callback: LockGrantedCallback<unknown>) => {
      if (_name === `readystate.local-session-privacy.${sessionId}`) await wait;
      return callback(null);
    });
    vi.stubGlobal("navigator", { locks: { request: lock } });
    await click("Retry approved save");
    expect(lock).toHaveBeenCalledWith(`readystate.local-session-privacy.${sessionId}`, { mode: "exclusive" }, expect.any(Function));
    await act(async () => {
      if (source === "session") {
        const privacy = loadLocalSessionPrivacy(localStorage, sessionId, baselineId);
        if (privacy.status !== "ready") throw new Error("Fixture privacy missing");
        saveLocalSessionPrivacy(localStorage, sessionId, { ...privacy.context, alwaysMask: [...privacy.context.alwaysMask, "quietorchid"] });
      } else usePrivacyStore.getState().setAlwaysMask(["quietorchid"]);
      responseFailure = undefined;
      release();
    });
    expect(writes).toHaveLength(1);
    const preview = container.querySelector<HTMLTextAreaElement>('textarea:not(#local-response)')!;
    expect(preview.value).not.toContain("quietorchid");
    expect(container.textContent).toContain("Review it again");
    await click("Send this");
    expect(writes).toHaveLength(2);
    expect(writes[1]).not.toContain("quietorchid");
  });
  it("retries unchanged uncommitted approval with the original text and idempotency key", async () => {
    await start("my sister Alice called");
    responseFailure = "uncommitted";
    await click("Send this");
    responseFailure = undefined;
    await click("Retry approved save");
    const responses = requests.filter(request => (request as { action: string }).action === "response");
    expect(responses).toHaveLength(2);
    expect(responses[1]).toEqual(responses[0]);
    expect(writes.every(text => !text.includes("Alice"))).toBe(true);
  });
  it.each(["pending", "accepted"])("reconciles an already committed %s response without retransmitting", async location => {
    await start("the codeword is quietorchid");
    responseFailure = "committed";
    await click("Send this");
    if (location === "accepted") {
      saved = { ...saved, revision: saved.revision + 1, pendingResponse: undefined,
        events: [...saved.events, { ...saved.events[0], id: randomUUID(), response: saved.pendingResponse }] };
    }
    localStorage.clear();
    usePrivacyStore.getState().setAlwaysMask(["quietorchid"]);
    await click("Retry approved save");
    expect(writes).toHaveLength(1);
    expect(container.querySelector('[aria-label="Unconfirmed save"]')).toBeNull();
  });
  it("refuses a stale uncommitted retry without overwriting privacy or sending", async () => {
    await start("my sister Alice called");
    responseFailure = "uncommitted";
    await click("Send this");
    const before = localStorage.getItem(`readystate.local-session-privacy.v1.session.${sessionId}`);
    saved = { ...saved, revision: 2 };
    await click("Retry approved save");
    expect(writes).toHaveLength(1);
    expect(localStorage.getItem(`readystate.local-session-privacy.v1.session.${sessionId}`)).toBe(before);
    expect(container.querySelector('[aria-label="Unconfirmed save"]')).toBeNull();
    expect(container.textContent).toContain("saved exercise changed");
  });
  it.each(["missing", "corrupt", "no-lock"])("blocks an uncommitted retry with %s privacy prerequisites", async failure => {
    await start("the codeword is quietorchid");
    responseFailure = "uncommitted";
    await click("Send this");
    if (failure === "no-lock") vi.stubGlobal("navigator", {});
    else if (failure === "missing") localStorage.clear();
    else localStorage.setItem(`readystate.local-session-privacy.v1.session.${sessionId}`, "invalid");
    await click("Retry approved save");
    expect(writes).toHaveLength(1);
    expect(container.querySelector('[aria-label="Unconfirmed save"]')).not.toBeNull();
    expect(container.textContent).toContain(failure === "no-lock" ? "coordination is unavailable" : "Restore this session's private context");
  });
  it.each(["lock", "state"])("freezes the editor and open mask confirmation while approval awaits %s", async stage => {
    await start("the codeword is quietorchid");
    const preview = container.querySelector<HTMLTextAreaElement>('textarea:not(#local-response)')!;
    const original = preview.value;
    const position = original.indexOf("quietorchid");
    preview.setSelectionRange(position, position + "quietorchid".length);
    await click("Mask selected text");
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    if (stage === "lock") vi.stubGlobal("navigator", {
      locks: { request: async (_name: string, _options: LockOptions, callback: LockGrantedCallback<unknown>) => { await wait; return callback(null); } },
    });
    else stateWait = wait;
    await click("Send this");
    expect(preview.disabled).toBe(true);
    const confirmation = container.querySelector('[aria-label="Confirm masking"]')!;
    expect([...confirmation.querySelectorAll("button")].every(button => button.disabled)).toBe(true);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(preview, "unapprovedsecret");
      preview.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Mask it");
    expect(writes).toEqual([]);
    expect(JSON.stringify({ ...localStorage })).not.toContain("quietorchid");
    await act(async () => { release(); });
    expect(writes).toEqual([original]);
    expect(writes[0]).not.toContain("unapprovedsecret");
    expect(JSON.stringify({ ...localStorage })).not.toContain("quietorchid");
  });
});

describe("local connection refresh races", () => {
  it("ignores an older saved-result response that arrives after a newer refresh", async () => {
    await startDiagnostic();
    const older = deferred();
    const newer = deferred();
    const olderStarted = deferred();
    const newerStarted = deferred();
    let stateCalls = 0;
    stateWaitQueue.set(sessionId, [older.promise, newer.promise]);
    onStateRequest = id => {
      if (id !== sessionId) return;
      stateCalls++;
      if (stateCalls === 1) olderStarted.resolve();
      if (stateCalls === 2) newerStarted.resolve();
    };

    await click("Send fictional diagnostic to Claude");
    await olderStarted.promise;
    saved = {
      ...saved,
      events: [{ ...fixtureEvent, turn: { ...fixtureEvent.turn, narrative_response: "Newer saved result." } }],
    };
    await click("Refresh accepted results");
    await newerStarted.promise;

    await act(async () => { newer.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); });
    await waitForText("Newer saved result.");
    await act(async () => { older.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(container.textContent).toContain("Newer saved result.");
    expect(container.textContent).not.toContain("Diagnostic result.");
  });

  it("does not restore the previously selected session after a session change during refresh", async () => {
    await startDiagnostic();
    const pending = deferred();
    const stateStarted = deferred();
    stateWaitBySession.set(sessionId, pending.promise);
    onStateRequest = id => { if (id === sessionId) stateStarted.resolve(); };

    await click("Send fictional diagnostic to Claude");
    await stateStarted.promise;
    await click(`Resume ${otherSessionId.slice(0, 8)} · loop`);
    await waitForText(`Exercise ${otherSessionId.slice(0, 8)}`);
    await act(async () => { pending.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(container.textContent).toContain(`Exercise ${otherSessionId.slice(0, 8)}`);
    expect(container.textContent).not.toContain(`Exercise ${sessionId.slice(0, 8)}`);
  });

  it("does not unlock setup when a saved-result refresh completes after locking", async () => {
    await startDiagnostic();
    const pending = deferred();
    const stateStarted = deferred();
    stateWaitBySession.set(sessionId, pending.promise);
    onStateRequest = id => { if (id === sessionId) stateStarted.resolve(); };

    await click("Send fictional diagnostic to Claude");
    await stateStarted.promise;
    await click("Lock setup");
    expect(container.querySelector("#owner-code")).not.toBeNull();
    await act(async () => { pending.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(container.querySelector("#owner-code")).not.toBeNull();
    expect([...container.querySelectorAll("button")].some(value => value.textContent === "Lock setup")).toBe(false);
  });
});
