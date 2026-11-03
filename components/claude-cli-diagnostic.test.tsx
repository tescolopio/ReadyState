// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClaudeCliDiagnostic } from "@/components/claude-cli-diagnostic";
import { DIAGNOSTIC_BASELINE, DIAGNOSTIC_CLI_REQUEST, diagnosticTurn } from "@/lib/connection-diagnostic.mjs";

let container: HTMLDivElement;
let root: Root;
const sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const onSaved = vi.fn(async () => {});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onSaved.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function button(text: string) {
  const found = [...container.querySelectorAll("button")].find(value => value.textContent === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}
async function click(text: string) { await act(async () => button(text).click()); }
async function render(accepted = false) {
  await act(async () => root.render(<ClaudeCliDiagnostic sessionId={sessionId} accepted={accepted} onSaved={onSaved} />));
}
it("detects runtime without a model call and keeps inference disabled by default", async () => {
  const calls: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    return Response.json({ installed: true, version: "2.1.300", authentication: "native-subscription", evaluationEnabled: false });
  }));
  await render();
  expect(button("Send fictional diagnostic to Claude").disabled).toBe(true);
  await click("Check installed Claude and sign-in");
  expect(calls).toEqual([{ action: "claude-status" }]);
  expect(button("Send fictional diagnostic to Claude").disabled).toBe(true);
  expect(container.textContent).toContain("claude auth login");
  expect(container.textContent).toContain(DIAGNOSTIC_BASELINE);
  expect(container.textContent).toContain(DIAGNOSTIC_CLI_REQUEST);
});
it("clears a previously successful auth check when the next check fails", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({
      installed: true, version: "2.1.300", authentication: "native-subscription", evaluationEnabled: true,
    }))
    .mockRejectedValueOnce(new Error("Native status check timed out."));
  vi.stubGlobal("fetch", fetchMock);
  await render();
  await click("Check installed Claude and sign-in");
  expect(button("Send fictional diagnostic to Claude").disabled).toBe(false);
  await click("Check installed Claude and sign-in");
  expect(button("Send fictional diagnostic to Claude").disabled).toBe(true);
  expect(container.textContent).not.toContain("Authentication: native-subscription");
  expect(container.textContent).toContain("Native status check timed out.");
});
it("sends a selected model from ReadyState and refreshes the saved acknowledgement", async () => {
  const calls: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    if (body.action === "claude-status") {
      return Response.json({ installed: true, version: "2.1.300", authentication: "native-subscription", evaluationEnabled: true });
    }
    return Response.json({
      id: sessionId, revision: 1, phase: "loop", baseline: { id: sessionId, text: DIAGNOSTIC_BASELINE },
      events: [{ id: sessionId, turn: diagnosticTurn }],
    });
  }));
  await render();
  await click("Check installed Claude and sign-in");
  const select = container.querySelector("select")!;
  await act(async () => { select.value = "haiku"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await click("Send fictional diagnostic to Claude");
  expect(calls).toEqual([{ action: "claude-status" }, { action: "claude-diagnostic", sessionId, model: "haiku" }]);
  expect(onSaved).toHaveBeenCalledTimes(1);
  await render(true);
  expect(button("Send fictional diagnostic to Claude").disabled).toBe(true);
  expect(container.textContent).toContain("Saved result retained");
});
it.each([
  ["ordinary connector event", { ...diagnosticTurn, narrative_response: "Ordinary assistant response." }, undefined],
  ["malformed diagnostic event", diagnosticTurn, { id: sessionId, text: "Unexpected approved response." }],
])("reports an incompatible session for a %s without refreshing it as accepted", async (_label, turn, response) => {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.action === "claude-status") {
      return Response.json({ installed: true, version: "2.1.300", authentication: "native-subscription", evaluationEnabled: true });
    }
    return Response.json({
      id: sessionId, revision: 1, phase: "loop", baseline: { id: sessionId, text: DIAGNOSTIC_BASELINE },
      events: [{ id: sessionId, turn, ...(response ? { response } : {}) }],
    });
  }));
  await render();
  await click("Check installed Claude and sign-in");
  await click("Send fictional diagnostic to Claude");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("incompatible with the ReadyState diagnostic protocol");
  expect(container.textContent).toContain("No diagnostic result was accepted.");
  expect(onSaved).not.toHaveBeenCalled();
});
it("cancels the request and warns to inspect saved state without auto-retry", async () => {
  const send = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.action === "claude-status") {
      return Response.json({ installed: true, version: "2.1.300", authentication: "native-subscription", evaluationEnabled: true });
    }
    return await new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  });
  vi.stubGlobal("fetch", send);
  await render();
  await click("Check installed Claude and sign-in");
  await click("Send fictional diagnostic to Claude");
  await click("Cancel Claude request");
  expect(container.textContent).toContain("Refresh accepted results before retrying");
  expect(onSaved).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(2);
  expect(button("Send fictional diagnostic to Claude").disabled).toBe(true);
});
