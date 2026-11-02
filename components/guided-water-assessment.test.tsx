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
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
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
  await click("Guided assessment"); await click("Explore water supplies");
}
describe("one household across Simple and Guided", () => {
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
    await click("Simple assessment"); await click("Guided assessment");
    await click("Help me count");
    expect([...container.querySelectorAll("input")].find(input => input.labels?.[0]?.textContent === "Number of 1 US gallon containers")?.value).toBe("2");
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => checkbox.click()); await click("Use counted amount");
    expect(useHouseholdStore.getState().profile.supplies.waterGallons).toBe(2);
    expect(container.textContent).toContain("about 2 days");
    const baseline = assessInventory(useHouseholdStore.getState().profile, { scenario: false });
    const action = baseline.find(finding => finding.rule === "water")!.action!;
    await click("Save to my plan");
    expect(usePlanStore.getState().items[0].text).toBe(action);
    await click("Mark water reviewed and return to topics");
    expect(container.textContent).toContain("Reviewed");
    await click("Simple assessment"); await click("Supplies");
    await fill("Stored water (gallons)", "9");
    await click("Guided assessment");
    expect(container.textContent).toContain("Needs review");
    expect(usePlanStore.getState().items[0].text).toBe(action);
    await act(async () => root.render(null));
    useLocalRecordsStore.getState().reload();
    await act(async () => root.render(<AssessmentPage />));
    expect(container.querySelector('[aria-label="Guided assessment"]')).not.toBeNull();
    expect(useHouseholdStore.getState().profile.supplies.waterGallons).toBe(9);
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
