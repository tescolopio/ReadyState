// @vitest-environment jsdom
import { randomUUID } from "node:crypto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ConnectionsPage from "@/app/(app)/connections/page";
import { newLocalSessionPrivacy, saveLocalSessionPrivacy } from "@/lib/local-session-privacy";
import type { LocalConnectionState } from "@/lib/local-connection-contracts";
import { usePrivacyStore } from "@/store/usePrivacyStore";

let container: HTMLDivElement;
let root: Root;
let saved: LocalConnectionState;
let writes: string[];
let requests: unknown[];
const sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const baselineId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  usePrivacyStore.setState({ alwaysMask: [], entityMap: {} });
  saved = {
    id: sessionId, revision: 1, phase: "loop",
    baseline: { id: baselineId, text: "Approved fictional household." },
    events: [{
      id: randomUUID(),
      turn: {
        feedback: null, narrative_response: "Fixture event.", hours_elapsed: 0, time_elapsed: "Hour 0",
        new_inject: "Fixture only.", critical_alerts: [], suggested_actions: [],
        response_options: ["Check.", "Wait.", "Ask."], scenario_status: "ongoing",
      },
    }],
  };
  saveLocalSessionPrivacy(localStorage, sessionId, newLocalSessionPrivacy(baselineId, ["originalprivateterm"]));
  writes = [];
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    if (body.action === "status") return Response.json({ sessions: [{ id: sessionId, revision: saved.revision, phase: "loop" }], connections: [] });
    if (body.action === "state") return Response.json(saved);
    if (body.action === "response") {
      writes.push(body.approval.text);
      saved = { ...saved, revision: saved.revision + 1, pendingResponse: body.approval };
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

describe("local connection send-time privacy", () => {
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
});
