// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AssessmentPage from "@/app/(app)/assessment/page";
import { emptyProfile, setSupplyAnswer } from "@/lib/household";
import { SAVES_KEY, createHouseholdSave, readNamedSaves, writeNamedSaves } from "@/lib/household-saves";
import { useHouseholdStore } from "@/store/useHouseholdStore";
import { usePlanStore } from "@/store/usePlanStore";
import { useLocalRecordsStore } from "@/store/useLocalRecordsStore";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Save/load must stay offline"); }));
  localStorage.clear();
  useLocalRecordsStore.getState().reload();
  useHouseholdStore.getState().setProfile(setSupplyAnswer(emptyProfile(), "smoke-detector", "absent"));
  usePlanStore.getState().clear();
  usePlanStore.getState().add({ text: "Original chosen action", source: "Synthetic test", kind: "plan" });
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
async function click(name: string) {
  const button = [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === name);
  if (!button) throw new Error(`Missing button: ${name}`);
  await act(async () => button.click());
}
async function fillName(name: string) {
  const input = [...container.querySelectorAll("input")].find(input => input.labels?.[0]?.textContent === "Save name")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function importJson(text: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File([text], "synthetic-household.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => text });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

describe("offline save/load controls", () => {
  it("saves independent named snapshots, confirms/cancels restore, reloads both profile and actions and confirms deletion", async () => {
    await act(async () => root.render(<AssessmentPage />));
    await fillName("Before winter");
    await click("Save a named copy");
    expect(readNamedSaves(localStorage)).toHaveLength(1);
    await fillName("Before winter");
    await click("Save a named copy");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("already saved");
    expect(readNamedSaves(localStorage)).toHaveLength(1);
    await act(async () => {
      useHouseholdStore.getState().setProfile(setSupplyAnswer(emptyProfile(), "smoke-detector", "present"));
      usePlanStore.getState().clear();
    });
    await click("Load Before winter");
    expect(useHouseholdStore.getState().profile.supplies.have).toContain("smoke-detector");
    await click("Cancel load");
    expect(useHouseholdStore.getState().profile.supplies.have).toContain("smoke-detector");
    await click("Load Before winter");
    await click("Replace household and plan");
    expect(useHouseholdStore.getState().profile.supplies.absent).toContain("smoke-detector");
    expect(usePlanStore.getState().items[0].text).toBe("Original chosen action");
    expect(container.querySelector('[aria-label="Confirmed gaps"]')?.textContent).toContain("No smoke detectors recorded");
    await click("Delete Before winter");
    expect(readNamedSaves(localStorage)).toHaveLength(1);
    await click("Keep save");
    await click("Delete Before winter");
    await click("Confirm delete");
    expect(readNamedSaves(localStorage)).toEqual([]);
    expect(useHouseholdStore.getState().profile.supplies.absent).toContain("smoke-detector");
    expect(usePlanStore.getState().items).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates file imports before confirmation and replaces stale wizard drafts only after approval", async () => {
    const saved = createHouseholdSave(emptyProfile(), []);
    await act(async () => root.render(<AssessmentPage />));
    await click("Supplies");
    const current = useHouseholdStore.getState().profile;
    await importJson("{");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("not valid JSON");
    expect(useHouseholdStore.getState().profile).toEqual(current);
    await importJson(JSON.stringify(saved));
    expect(container.querySelector('[aria-label="Confirm household restore"]')).not.toBeNull();
    expect(useHouseholdStore.getState().profile).toEqual(current);
    await click("Replace household and plan");
    expect(useHouseholdStore.getState().profile).toEqual(saved.household);
    expect(usePlanStore.getState().items).toEqual([]);
    expect(container.querySelector('[aria-label="Household setup"]')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces quota errors without changing named saves or claiming success", async () => {
    await act(async () => root.render(<AssessmentPage />));
    await fillName("Cannot save");
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === SAVES_KEY) throw new DOMException("Quota", "QuotaExceededError");
      original.call(this, key, value);
    });
    await click("Save a named copy");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
    expect(readNamedSaves(localStorage)).toEqual([]);
  });

  it("keeps a corrupt named library intact and reports the failure", async () => {
    localStorage.setItem(SAVES_KEY, "broken");
    await act(async () => root.render(<AssessmentPage />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Named saves could not be read");
    expect(container.textContent).not.toContain("No named saves yet");
    expect(localStorage.getItem(SAVES_KEY)).toBe("broken");
  });

  it("reads a named library from a previous application run", async () => {
    const saved = createHouseholdSave(emptyProfile(), []);
    writeNamedSaves(localStorage, [{ id: "earlier", name: "Earlier run", snapshot: saved }]);
    await act(async () => root.render(<AssessmentPage />));
    expect(container.textContent).toContain("Earlier run");
    await click("Load Earlier run");
    await click("Replace household and plan");
    expect(useHouseholdStore.getState().profile).toEqual(saved.household);
    expect(fetch).not.toHaveBeenCalled();
  });
});
