// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AssessmentPage from "@/app/(app)/assessment/page";
import { emptyProfile, setSupplyAnswer } from "@/lib/household";
import { assessInventory } from "@/lib/inventory";
import { useHouseholdStore } from "@/store/useHouseholdStore";
import { usePlanStore } from "@/store/usePlanStore";
import { useLocalRecordsStore } from "@/store/useLocalRecordsStore";
import { invalidateHouseholdWizards } from "@/lib/household-restore";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Guided assessment must stay offline"); }));
  localStorage.clear();
  useLocalRecordsStore.getState().reload();
  useHouseholdStore.getState().setProfile({ ...emptyProfile(), people: [{ id: "adult", ageRange: "adult", needs: [] }] });
  usePlanStore.getState().clear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(button => button.textContent === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
}
async function fill(label: string, value: string) {
  const input = [...container.querySelectorAll("input")].find(input => input.labels?.[0]?.textContent === label)!;
  expect(input, label).toBeDefined();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function start() {
  await act(async () => root.render(<AssessmentPage />));
  await click("Guided assessment"); await click("Continue"); await click("Continue");
}
async function resume() {
  await click("Guided assessment"); await click("Resume guided session");
}
describe("one household across Simple and Guided", () => {
  it("can leave Guided without saving when progress writes fail", async () => {
    await start();
    const stored = localStorage.getItem("readystate-local-records");
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key, value) {
      if (key === "readystate-local-records") throw new DOMException("Full", "QuotaExceededError");
      return original.call(this, key, value);
    });
    await click("Save and exit");
    expect(container.textContent).toContain("could not be saved");
    await click("Return to Simple without saving progress");
    expect(container.querySelector('[aria-label="Guided assessment"]')).toBeNull();
    expect(useLocalRecordsStore.getState().simpleRecovery).toBe(true);
    expect(localStorage.getItem("readystate-local-records")).toBe(stored);
    vi.restoreAllMocks();
  });
  it("does not overwrite restored household facts through an open Guided people editor", async () => {
    await start(); await click("Keep current answer and see findings"); await click("Add or edit people");
    await act(async () => {
      useHouseholdStore.getState().setProfile({ ...emptyProfile(), people: [{ id: "restored", needs: [] }], supplies: { have: [], waterGallons: 17 } });
      invalidateHouseholdWizards();
    });
    await fill("Person 1 name (optional, this device only)", "Fictional restored person");
    expect(useHouseholdStore.getState().profile.people[0].id).toBe("restored");
    expect(useHouseholdStore.getState().profile.supplies.waterGallons).toBe(17);
  });
  it("preserves the Simple topic on ordinary exits and keeps unknown checks visible at next steps", async () => {
    await act(async () => root.render(<AssessmentPage />));
    await click("Supplies");
    await click("Guided assessment");
    await click("Continue"); await click("Continue"); await click("Not sure");
    await click("Continue to next steps");
    const unassessed = container.querySelector('[aria-label="Unassessed answers"]')!.textContent!;
    expect(unassessed).toContain("stored quantity is unanswered");
    expect(unassessed).not.toContain("None identified");
    await click("Save and exit");
    expect(useLocalRecordsStore.getState().data.progress).toBe(4);
    expect(container.querySelector('[aria-label="Household setup"]')?.textContent).toContain("Supplies");
  });
  it("explains duration using the same unrounded daily pet allowance as the engine", async () => {
    const profile = { ...useHouseholdStore.getState().profile,
      pets: [{ id: "dog", kind: "dog" as const, weightLb: 10 }],
      supplies: { have: [], waterGallons: 3.3 } };
    useHouseholdStore.getState().setProfile(profile);
    await start(); await click("Keep current answer and see findings");
    const explanation = container.querySelector('[aria-label="Water calculation explained"]')!.textContent!;
    expect(explanation).toContain("Daily estimate: about 1.078 US gallons");
    expect(explanation).toContain("3.3 stored US gallons provides about 3.06 days using the unrounded daily estimate");
    expect(explanation).not.toContain("/ daily estimate =");
    expect(assessInventory(profile, { scenario: false }).find(finding => finding.rule === "water")?.status).toBe("partial");
  });
  it("keeps the wizard mounted and keyboard step focus when persisting navigation", async () => {
    await act(async () => root.render(<AssessmentPage />));
    await click("People");
    const next = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Next"))!;
    expect(next).toBeDefined();
    next.focus();
    await act(async () => next.click());
    expect(next.isConnected).toBe(true);
    expect(document.activeElement).toBe(next);
    expect(useLocalRecordsStore.getState().data.progress).toBe(1);
  });
  it("displays concise rounded quantities without replacing exact saved answers", async () => {
    const exact = 2.2641720523581483;
    useHouseholdStore.getState().setProfile({ ...useHouseholdStore.getState().profile, supplies: { have: [], waterGallons: exact } });
    await start(); await click("Enter an amount");
    expect([...container.querySelectorAll("input")].find(input => input.type === "number")?.value).toBe("2.264");
    await click("Explain this answer");
    expect(container.textContent).not.toContain(String(exact));
    expect(container.textContent).toContain("2.264 stored US gallons");
    const assumptions = [...container.querySelectorAll("details")].find(details => details.querySelector("summary")?.textContent === "Assumptions and limits");
    expect(assumptions).toBeDefined();
    expect(assumptions?.open).toBe(false);
    expect(container.textContent).toContain("Well-pump continuity: water source is unanswered");
    await click("Save and exit"); await click("Supplies");
    const input = [...container.querySelectorAll("input")].find(input => input.labels?.[0]?.textContent === "Stored water (gallons)")!;
    expect(input.value).toBe("2.264");
    expect(useHouseholdStore.getState().profile.supplies.waterGallons).toBe(exact);
  });
  it("preserves uncertainty states and independent deficiencies instead of inventing water gaps", async () => {
    const profile = useHouseholdStore.getState().profile;
    useHouseholdStore.getState().setProfile(setSupplyAnswer({ ...profile, supplies: { have: [], foodDays: 0 } }, "smoke-detector", "absent"));
    await start();
    await click("I have none (zero)");
    expect(useHouseholdStore.getState().profile.supplies.waterGallons).toBe(0);
    expect(container.textContent).toContain("below the 3-day minimum");
    for (const [label, expected] of [["Not sure", "unknown"], ["Skip for now", "skipped"], ["Prefer not to say", "withheld"]]) {
      await click("Edit water answer"); await click(label);
      const current = useHouseholdStore.getState().profile;
      expect(current.supplies.waterGallons).toBeUndefined();
      expect(current.answers?.["supplies.waterGallons"]).toBe(expected);
      expect(assessInventory(current, { scenario: false }).some(item => item.rule === "water" && item.category === "gap")).toBe(false);
      expect(assessInventory(current, { scenario: false }).some(item => item.finding.includes("No smoke detectors"))).toBe(true);
      expect(current.supplies.foodDays).toBe(0);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps calculator drafts separate until confirmed and resumes counts after reload/mode switches", async () => {
    await start(); await click("Help me count");
    await fill("Number of 1 US gallon containers", "2");
    expect(useHouseholdStore.getState().profile.supplies.waterGallons).toBeUndefined();
    expect([...container.querySelectorAll("button")].find(button => button.textContent === "Use counted amount")?.disabled).toBe(true);
    await click("Save and exit"); await resume();
    expect([...container.querySelectorAll("input")].find(input => input.labels?.[0]?.textContent === "Number of 1 US gallon containers")?.value).toBe("2");
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => checkbox.click()); await click("Use counted amount");
    expect(useHouseholdStore.getState().profile.supplies.waterGallons).toBe(2);
    expect(container.textContent).toContain("about 2 days");
    const baseline = assessInventory(useHouseholdStore.getState().profile, { scenario: false });
    const action = baseline.find(finding => finding.rule === "water")!.action!;
    await click("Continue to next steps"); await click("Save to my plan");
    expect(usePlanStore.getState().items[0].text).toBe(action);
    await click("Finish water review");
    expect(container.textContent).toContain("Reviewed");
    await click("Save and exit"); await click("Supplies");
    await fill("Stored water (gallons)", "9");
    await resume();
    expect(container.textContent).toContain("Needs review");
    expect(usePlanStore.getState().items[0].text).toBe(action);
    await act(async () => root.render(null));
    useLocalRecordsStore.getState().reload();
    await act(async () => root.render(<AssessmentPage />));
    expect(container.querySelector('[aria-label="Guided assessment"]')).not.toBeNull();
    expect(useHouseholdStore.getState().profile.supplies.waterGallons).toBe(9);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("offers a focused staged session, explicit resume/restart and answer-preserving exit", async () => {
    await act(async () => root.render(<AssessmentPage />));
    await click("Guided assessment");
    expect(container.textContent).toContain("Who is in your household?");
    expect(container.querySelector('[aria-label="Ways to answer water question"]')).toBeNull();
    expect(container.querySelector('[aria-label="Steps"]')).toBeNull();
    expect(container.textContent).not.toContain("Full encrypted backups");
    await click("Continue");
    expect(container.textContent).toContain("Are there pets to include?");
    await click("Continue"); await click("Help me count");
    await fill("Number of 1 US gallon containers", "4");
    await click("Save and exit"); await click("Guided assessment");
    expect(container.textContent).toContain("Return to your guided session");
    await click("Resume guided session");
    expect([...container.querySelectorAll("input")].find(input => input.labels?.[0]?.textContent === "Number of 1 US gallon containers")?.value).toBe("4");
    await click("Save and exit"); await click("Guided assessment"); await click("Start from beginning");
    expect(container.textContent).toContain("Who is in your household?");
    expect(useHouseholdStore.getState().profile.people).toHaveLength(1);
    expect(useLocalRecordsStore.getState().data.guidedAssessment?.counts.gallon1).toBe("4");
    await click("Continue"); await click("Back");
    expect(container.textContent).toContain("Who is in your household?");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("clears a numeric answer to skipped and does not infer a person count or pet weight", async () => {
    useHouseholdStore.getState().setProfile({ ...emptyProfile(), pets: [{ id: "dog", kind: "dog" }] });
    await start(); await click("Enter an amount"); await fill("Stored drinking water (US gallons)", "4");
    await click("Explain this answer");
    expect(container.textContent).toContain("No person count is recorded");
    expect(container.textContent).toContain("weights are missing");
    await click("Edit water answer"); await click("Enter an amount");
    await fill("Stored drinking water (US gallons)", "");
    expect(useHouseholdStore.getState().profile.answers?.["supplies.waterGallons"]).toBe("skipped");
    expect(useHouseholdStore.getState().profile.supplies.waterGallons).toBeUndefined();
  });
});
