// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AlwaysMaskCard } from "@/components/always-mask";
import { loadLocalPrivacySettings, saveLocalPrivacySettings, withLocalSessionPrivacyLock } from "@/lib/local-session-privacy";
import { usePrivacyStore } from "@/store/usePrivacyStore";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  usePrivacyStore.setState({ alwaysMask: [], entityMap: {} });
  const tails = new Map<string, Promise<unknown>>();
  vi.stubGlobal("navigator", {
    locks: {
      request: (name: string, _options: LockOptions, callback: LockGrantedCallback<unknown>) => {
        const next = (tails.get(name) ?? Promise.resolve()).then(() => callback(null));
        tails.set(name, next.catch(() => {}));
        return next;
      },
    },
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

async function submit(text: string) {
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

it("keeps another tab's Settings write pending until a session's outbound operation finishes", async () => {
  await act(async () => root.render(<AlwaysMaskCard />));
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const running = new Promise<void>(resolve => { entered = resolve; });
  const sending = withLocalSessionPrivacyLock("fixture-session", async () => {
    entered();
    await wait;
  });
  await running;
  await submit("quietorchid");
  expect(container.textContent).toContain("Waiting to save");
  expect(usePrivacyStore.getState().alwaysMask).toEqual([]);
  expect(loadLocalPrivacySettings(localStorage)).toEqual([]);
  await act(async () => { release(); await sending; });
  expect(loadLocalPrivacySettings(localStorage)).toEqual(["quietorchid"]);
  expect(usePrivacyStore.getState().alwaysMask).toEqual(["quietorchid"]);
});

it("restores saved Settings rules without restoring private tag mappings", async () => {
  await saveLocalPrivacySettings(localStorage, ["quietorchid"]);
  await act(async () => root.render(<AlwaysMaskCard />));
  expect(container.querySelector("input")!.value).toBe("quietorchid");
  expect(usePrivacyStore.getState().alwaysMask).toEqual(["quietorchid"]);
  expect(usePrivacyStore.getState().entityMap).toEqual({});
});

it("fails closed rather than changing Settings without cross-tab coordination", async () => {
  vi.stubGlobal("navigator", {});
  await act(async () => root.render(<AlwaysMaskCard />));
  await submit("quietorchid");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("were not changed");
  expect(usePrivacyStore.getState().alwaysMask).toEqual([]);
  expect(loadLocalPrivacySettings(localStorage)).toEqual([]);
});

it("does not update this tab's rules when browser storage rejects a Settings write", async () => {
  await act(async () => root.render(<AlwaysMaskCard />));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  await submit("quietorchid");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("were not changed");
  expect(usePrivacyStore.getState().alwaysMask).toEqual([]);
  expect(loadLocalPrivacySettings(localStorage)).toEqual([]);
});
