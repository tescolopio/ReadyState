// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { emptyProfile, setSupplyAnswer } from "@/lib/household";
import {
  SAVES_KEY, createHouseholdSave, parseHouseholdSave, readNamedSaves,
  restoreHouseholdSave, writeNamedSaves,
} from "@/lib/household-saves";
import { useHouseholdStore } from "@/store/useHouseholdStore";
import { usePlanStore, type PlanItem } from "@/store/usePlanStore";

const plan: PlanItem[] = [{
  id: "action", text: "Check supplies", source: "Household assessment", kind: "plan",
  status: "in-progress", addedAt: "2026-11-02T00:00:00.000Z",
}];
function snapshot() {
  let household = emptyProfile();
  household.people = [{ id: "adult", localName: "Synthetic only", ageRange: "adult", needs: [{ kind: "daily-medication", daysSupply: 0, localDetail: "Fictional detail" }], absentNeeds: ["stairs"] }];
  household.pets = [{ id: "dog", kind: "dog", notes: "Synthetic notes" }];
  household.home = { basement: false, backupPower: "none" };
  household.supplies.foodDays = 0;
  household = setSupplyAnswer(setSupplyAnswer(household, "smoke-detector", "absent"), "formula", "not-applicable");
  household = setSupplyAnswer(setSupplyAnswer(household, "first-aid", "unknown"), "fuel", "withheld");
  household = setSupplyAnswer(household, "batteries", "skipped");
  return createHouseholdSave(household, plan);
}
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("local household snapshots", () => {
  it("round-trips the complete profile, answer states, local details and chosen action status without provider settings or exercise history", () => {
    const saved = snapshot();
    expect(parseHouseholdSave(JSON.stringify(saved))).toEqual(saved);
    expect(saved.household.supplies.foodDays).toBe(0);
    expect(saved.household.home.basement).toBe(false);
    expect(Object.keys(saved).sort()).toEqual(["format", "household", "plan", "savedAt", "version"]);
    const second = createHouseholdSave(saved.household, saved.plan);
    saved.household.people[0].localName = "Changed copy";
    saved.plan[0].status = "done";
    expect(second.household.people[0].localName).toBe("Synthetic only");
    expect(second.plan[0].status).toBe("in-progress");
  });

  it("makes independent named copies that persist, and deleting them leaves working stores alone", () => {
    const saved = snapshot();
    const named = { id: "named", name: "Winter", snapshot: saved };
    writeNamedSaves(localStorage, [named]);
    saved.household.supplies.foodDays = 8;
    expect(readNamedSaves(localStorage)[0].snapshot.household.supplies.foodDays).toBe(0);
    const active = localStorage.getItem("readystate-household");
    writeNamedSaves(localStorage, []);
    expect(readNamedSaves(localStorage)).toEqual([]);
    expect(localStorage.getItem("readystate-household")).toBe(active);
  });

  it("restores both stores across real rehydration without touching unrelated data or named snapshots", async () => {
    const saved = snapshot();
    localStorage.setItem("readystate-settings", '{"do-not-change":"synthetic"}');
    writeNamedSaves(localStorage, [{ id: "named", name: "Winter", snapshot: saved }]);
    restoreHouseholdSave(localStorage, saved);
    await useHouseholdStore.persist.rehydrate();
    await usePlanStore.persist.rehydrate();
    expect(useHouseholdStore.getState().profile).toEqual(saved.household);
    expect(usePlanStore.getState().items).toEqual(saved.plan);
    expect(localStorage.getItem("readystate-settings")).toBe('{"do-not-change":"synthetic"}');
    expect(readNamedSaves(localStorage)).toHaveLength(1);
  });

  it.each([
    (value: ReturnType<typeof snapshot>) => ({ ...value, version: 99 }),
    (value: ReturnType<typeof snapshot>) => ({ ...value, settings: { apiKey: "not-a-real-key" } }),
    (value: ReturnType<typeof snapshot>) => ({ ...value, household: { ...value.household, apiKey: "not-a-real-key" } }),
    (value: ReturnType<typeof snapshot>) => ({ ...value, household: { ...value.household, scenario: "invalid" } }),
    (value: ReturnType<typeof snapshot>) => ({ ...value, household: { ...value.household, supplies: { have: ["unknown-item"] } } }),
    (value: ReturnType<typeof snapshot>) => ({ ...value, household: { ...value.household, supplies: { have: ["fuel"], absent: ["fuel"] } } }),
    (value: ReturnType<typeof snapshot>) => ({ ...value, household: { ...value.household, answers: { "supplies.fuel": "not-applicable" } } }),
    (value: ReturnType<typeof snapshot>) => ({ ...value, plan: [{ ...value.plan[0], status: "invalid" }] }),
    (value: ReturnType<typeof snapshot>) => ({ ...value, plan: [{ ...value.plan[0], addedAt: "not-a-date" }] }),
    (value: ReturnType<typeof snapshot>) => ({ ...value, plan: [...value.plan, value.plan[0]] }),
    (value: ReturnType<typeof snapshot>) => ({ ...value, household: { ...value.household, answers: { "person.not-there.ageRange": "unknown" } } }),
    (value: ReturnType<typeof snapshot>) => ({ ...value, household: { ...value.household, answers: { "home.basement": "withheld" } } }),
  ])("rejects invalid, conflicting, unsupported or out-of-scope data before any restore", mutate => {
    const before = localStorage.length;
    expect(() => parseHouseholdSave(JSON.stringify(mutate(snapshot())))).toThrow(/not a supported/);
    expect(localStorage.length).toBe(before);
  });

  it("rejects invalid JSON and oversized files", () => {
    expect(() => parseHouseholdSave("{")).toThrow(/not valid JSON/);
    expect(() => parseHouseholdSave(" ".repeat(2 * 1024 * 1024 + 1))).toThrow(/2 MiB/);
  });

  it("reports corrupt named storage instead of silently replacing it with an empty library", () => {
    localStorage.setItem(SAVES_KEY, '{"version":99,"saves":[]}');
    expect(() => readNamedSaves(localStorage)).toThrow();
    expect(localStorage.getItem(SAVES_KEY)).toBe('{"version":99,"saves":[]}');
  });

  it("rolls back the first write if plan persistence fails, without success-shaped partial restore", () => {
    localStorage.setItem("readystate-household", "old household");
    localStorage.setItem("readystate-plan", "old plan");
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === "readystate-plan") throw new DOMException("Quota exceeded", "QuotaExceededError");
      original.call(this, key, value);
    });
    expect(() => restoreHouseholdSave(localStorage, snapshot())).toThrow(/Previous household and plan were retained/);
    expect(localStorage.getItem("readystate-household")).toBe("old household");
    expect(localStorage.getItem("readystate-plan")).toBe("old plan");
  });
});
