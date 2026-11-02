// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AssessmentPage from "@/app/(app)/assessment/page";
import PlanPage from "@/app/(app)/plan/page";
import { emptyProfile } from "@/lib/household";
import { useHouseholdStore } from "@/store/useHouseholdStore";
import { usePlanStore } from "@/store/usePlanStore";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Offline assessment must not make requests"); }));
  localStorage.clear();
  useHouseholdStore.getState().setProfile(emptyProfile());
  usePlanStore.getState().clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === text);
  if (!button) throw new Error(`Missing button: ${text}`);
  await act(async () => button.click());
}
function select(label: string) {
  const control = [...container.querySelectorAll("select")].find(select =>
    select.labels?.[0]?.textContent === label || select.getAttribute("aria-label") === label);
  if (!control) throw new Error(`Missing select: ${label}`);
  return control;
}
async function answer(label: string, value: string) {
  const control = select(label);
  await act(async () => {
    control.value = value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("offline assessment experience", () => {
  it("completes a short profile, confirms a gap, explains evidence and saves an action without exercise or AI", async () => {
    await act(async () => root.render(<AssessmentPage />));
    await click("adult");
    await click("See assessment");
    expect(container.textContent).toContain("Unassessed answers");
    expect(container.textContent).not.toContain("No smoke detectors recorded");
    expect(container.querySelector('a[href="/exercises"]')?.textContent).toContain("optional");
    await click("Supplies");
    expect([...select("Smoke detectors").options].some(option => option.value === "not-applicable")).toBe(false);
    expect([...select("Ready-to-feed infant formula").options].some(option => option.value === "not-applicable")).toBe(true);
    await answer("Smoke detectors", "absent");
    await answer("First aid kit", "unknown");
    await click("See assessment");
    const gaps = container.querySelector('[aria-label="Confirmed gaps"]')!;
    expect(gaps.textContent).toContain("No smoke detectors recorded");
    expect(gaps.textContent).not.toContain("first aid");
    expect(gaps.textContent).toContain("smoke-detector");
    expect(container.querySelector('[aria-label="Unassessed answers"]')?.textContent).toContain("Unknown");
    const save = gaps.querySelector<HTMLButtonElement>("button")!;
    await act(async () => save.click());
    expect(usePlanStore.getState().items).toHaveLength(1);
    expect(save.textContent).toBe("Saved to plan");
    await act(async () => {
      await useHouseholdStore.persist.rehydrate();
      await usePlanStore.persist.rehydrate();
    });
    await act(async () => root.render(<PlanPage />));
    expect(container.textContent).toContain(usePlanStore.getState().items[0].text);
    await answer("Status", "done");
    expect(usePlanStore.getState().items[0].status).toBe("done");
    await act(async () => root.render(<AssessmentPage />));
    expect(container.textContent).toContain("Confirmed gaps");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps explicit zero separate from clearing, and resumes a supplies-only profile", async () => {
    await act(async () => root.render(<AssessmentPage />));
    await click("Supplies");
    const input = [...container.querySelectorAll("input")].find(input => input.labels?.[0]?.textContent === "Food (days)")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "0");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(useHouseholdStore.getState().profile.supplies.foodDays).toBe(0);
    await click("See assessment");
    expect(container.querySelector('[aria-label="Confirmed gaps"]')?.textContent).toContain("Food covers about 0 days");
    await act(async () => root.render(<PlanPage />));
    expect(container.textContent).toContain("Suggested by your household check");
    await act(async () => root.render(<AssessmentPage />));
    expect(container.querySelector('[aria-label="Confirmed gaps"]')?.textContent).toContain("Food covers about 0 days");
    await click("Supplies");
    await answer("Food (days): answer status", "skipped");
    expect(useHouseholdStore.getState().profile.supplies.foodDays).toBeUndefined();
    await click("See assessment");
    expect(container.querySelector('[aria-label="Confirmed gaps"]')?.textContent).not.toContain("Food covers about");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("clears hidden battery ratings when backup power becomes unknown, without reviving them on edit", async () => {
    const profile = emptyProfile();
    profile.home = { backupPower: "battery", backupWatts: 500, backupWh: 1000 };
    useHouseholdStore.getState().setProfile(profile);
    await act(async () => root.render(<AssessmentPage />));
    await click("Home");
    await answer("Backup power", "unknown");
    expect(useHouseholdStore.getState().profile.home).toMatchObject({
      backupPower: undefined, backupWatts: undefined, backupWh: undefined,
    });
    expect(useHouseholdStore.getState().profile.answers?.["home.backupPower"]).toBe("unknown");
    await answer("Backup power", "battery");
    expect(useHouseholdStore.getState().profile.answers?.["home.backupPower"]).toBeUndefined();
    expect(useHouseholdStore.getState().profile.home.backupWh).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("edits and clears answers without retaining a stale absence", async () => {
    await act(async () => root.render(<AssessmentPage />));
    await click("adult");
    await click("Supplies");
    await answer("Smoke detectors", "absent");
    await answer("First aid kit", "present");
    await answer("Smoke detectors", "withheld");
    expect(useHouseholdStore.getState().profile.supplies.absent).toEqual([]);
    await answer("Food (days): answer status", "unknown");
    expect(useHouseholdStore.getState().profile.answers?.["supplies.foodDays"]).toBe("unknown");
    await answer("Smoke detectors", "skipped");
    await click("See assessment");
    expect(container.querySelector('[aria-label="Confirmed gaps"]')?.textContent).not.toContain("smoke detectors");
    expect(useHouseholdStore.getState().profile.supplies.have).toContain("first-aid");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps earlier chosen actions understandable and unchanged when their supporting answer is withheld or corrected", async () => {
    await act(async () => root.render(<AssessmentPage />));
    await click("adult");
    await click("Supplies");
    await answer("Smoke detectors", "absent");
    await answer("Food (days): answer status", "unknown");
    await click("See assessment");
    const save = container.querySelector<HTMLButtonElement>('[aria-label="Confirmed gaps"] button')!;
    await act(async () => save.click());
    const original = { ...usePlanStore.getState().items[0] };
    for (const value of ["withheld", "present"]) {
      await click("Supplies");
      await answer("Smoke detectors", value);
      await click("See assessment");
      expect(container.querySelector('[aria-label="Confirmed gaps"]')?.textContent).not.toContain("No smoke detectors");
      await act(async () => root.render(<PlanPage />));
      expect(container.textContent).toContain(original.text);
      expect(container.textContent).toContain("not a live list of deficiencies");
      expect(container.textContent).toContain("Changing answers does not rewrite, remove or complete an action");
      expect(container.querySelector("time")?.dateTime).toBe(original.addedAt);
      expect(usePlanStore.getState().items).toEqual([original]);
      await act(async () => root.render(<AssessmentPage />));
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("removes health-answer provenance when the need or person is removed", async () => {
    await act(async () => root.render(<AssessmentPage />));
    await click("adult");
    await click("Health needs");
    await answer("Daily medication they can't skip", "present");
    const status = [...container.querySelectorAll("select")].find(select =>
      select.getAttribute("aria-label")?.endsWith(": answer status"))!;
    await act(async () => {
      status.value = "withheld";
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(Object.keys(useHouseholdStore.getState().profile.answers ?? {}).some(key => key.endsWith(".daysSupply"))).toBe(true);
    await answer("Daily medication they can't skip", "absent");
    expect(Object.keys(useHouseholdStore.getState().profile.answers ?? {}).some(key => key.endsWith(".daysSupply"))).toBe(false);
    expect(useHouseholdStore.getState().profile.people[0].absentNeeds).toContain("daily-medication");
    await answer("Medical device that needs power", "withheld");
    await click("People");
    await answer("Age range", "unknown");
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label^="Remove Person"]')!;
    await act(async () => remove.click());
    expect(useHouseholdStore.getState().profile.people).toEqual([]);
    expect(useHouseholdStore.getState().profile.answers).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["Daily medication they can't skip", "Days of supply on hand", "daysSupply"],
    ["Medical device that needs power", "Power draw (watts, from the label)", "watts"],
  ])("keeps an explicit skipped state when %s's numeric input is cleared", async (needLabel, fieldLabel, key) => {
    await act(async () => root.render(<AssessmentPage />));
    await click("adult");
    await click("Health needs");
    await answer(needLabel, "present");
    const input = [...container.querySelectorAll("input")].find(input => input.labels?.[0]?.textContent === fieldLabel)!;
    const fill = async (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await fill("5");
    await fill("");
    const person = useHouseholdStore.getState().profile.people[0];
    expect(useHouseholdStore.getState().profile.answers?.[`need.${person.id}.${person.needs[0].kind}.${key}`]).toBe("skipped");
    expect(input.value).toBe("");
    await fill("0");
    expect(useHouseholdStore.getState().profile.answers?.[`need.${person.id}.${person.needs[0].kind}.${key}`]).toBeUndefined();
    expect(input.value).toBe("0");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("migrates real version-zero storage and keeps positive facts while old unchecked items stay unassessed", async () => {
    const old = emptyProfile();
    old.people = [{ id: "adult", ageRange: "adult", needs: [] }];
    old.supplies = { waterGallons: 0, foodDays: 4, have: ["first-aid"] };
    old.home.backupPower = "none";
    localStorage.setItem("readystate-household", JSON.stringify({ state: { profile: old }, version: 0 }));
    await act(async () => useHouseholdStore.persist.rehydrate());
    const migrated = useHouseholdStore.getState().profile;
    expect(migrated.supplies).toEqual({ ...old.supplies, absent: [] });
    expect(migrated.home.backupPower).toBe("none");
    expect(JSON.parse(localStorage.getItem("readystate-household")!).version).toBe(1);
    await act(async () => root.render(<AssessmentPage />));
    expect(container.querySelector('[aria-label="Confirmed gaps"]')?.textContent).toContain("Stored water covers about 0 days");
    expect(container.textContent).not.toContain("No smoke detectors recorded");
    expect(fetch).not.toHaveBeenCalled();
  });
});
