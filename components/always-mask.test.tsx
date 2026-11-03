// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AlwaysMaskCard } from "@/components/always-mask";
import {
  addAlwaysMaskRule,
  loadLocalPrivacySettings,
  saveLocalPrivacySettings,
  withLocalSessionPrivacyLock,
} from "@/lib/local-session-privacy";
import { createApprover, prepareReview } from "@/lib/outgoing-review";
import { usePrivacyStore } from "@/store/usePrivacyStore";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  usePrivacyStore.setState({
    alwaysMask: [],
    alwaysMaskInitialized: false,
    alwaysMaskPersisted: false,
    entityMap: {},
  });
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

it("keeps an API-only exercise mask in memory when Web Locks are unavailable", async () => {
  await saveLocalPrivacySettings(localStorage, ["stale"]);
  vi.stubGlobal("navigator", {});
  await act(async () => root.render(<AlwaysMaskCard />));
  expect(usePrivacyStore.getState().alwaysMask).toEqual(["stale"]);
  await submit("quietorchid");
  expect(container.textContent).toContain("memory only");
  expect(container.querySelector('[role="status"]')?.textContent).toContain("lost when the page is reloaded");
  expect(container.textContent).toContain("will be lost when the page is reloaded");
  expect(usePrivacyStore.getState().alwaysMask).toEqual(["quietorchid"]);
  expect(loadLocalPrivacySettings(localStorage)).toEqual(["stale"]);
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<AlwaysMaskCard />));
  expect(usePrivacyStore.getState().alwaysMask).toEqual(["quietorchid"]);
  expect(container.textContent).toContain("memory only");
});

it("keeps an exercise-selected mask across card remounts and approval despite stale storage", async () => {
  await saveLocalPrivacySettings(localStorage, ["stale"]);
  await act(async () => root.render(<AlwaysMaskCard />));
  expect(usePrivacyStore.getState().alwaysMask).toEqual(["stale"]);

  const update = await addAlwaysMaskRule(localStorage, usePrivacyStore.getState().alwaysMask, "quietorchid");
  expect(update).toEqual({ rules: ["stale", "quietorchid"], persisted: true });
  await act(async () => usePrivacyStore.getState().setAlwaysMask(update.rules, update.persisted));
  expect(loadLocalPrivacySettings(localStorage)).toEqual(["stale", "quietorchid"]);
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<AlwaysMaskCard />));

  expect(usePrivacyStore.getState().alwaysMask).toEqual(["stale", "quietorchid"]);
  expect(container.querySelector("input")!.value).toBe("stale, quietorchid");
  expect(loadLocalPrivacySettings(localStorage)).toEqual(["stale", "quietorchid"]);

  const review = prepareReview("response", mask => mask("quietorchid is private"), {}, usePrivacyStore.getState().alwaysMask);
  const send = vi.fn();
  const approve = createApprover({
    ledger: () => ({}),
    addMapping: vi.fn(),
    alwaysMask: () => usePrivacyStore.getState().alwaysMask,
    send,
  });
  expect(review.text).not.toContain("quietorchid");
  expect(approve(review)).toEqual({ status: "sent" });
  expect(send).toHaveBeenCalledExactlyOnceWith(review.text, review);
  expect(review.text).toMatch(/\[Person \d+\]/);
});

it("does not update this tab's rules when browser storage rejects a Settings write", async () => {
  await act(async () => root.render(<AlwaysMaskCard />));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  await submit("quietorchid");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("were not changed");
  expect(usePrivacyStore.getState().alwaysMask).toEqual([]);
  expect(loadLocalPrivacySettings(localStorage)).toEqual([]);
});
