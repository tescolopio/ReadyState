import { describe, expect, it } from "vitest";

import { emptyProfile, migrateHousehold, setSupplyAnswer, type HouseholdProfile } from "@/lib/household";
import { assessInventory, engineBaseline } from "@/lib/inventory";

function profile(): HouseholdProfile {
  const result = emptyProfile();
  result.people = [{ id: "synthetic-adult", ageRange: "adult", needs: [] }];
  return result;
}

describe("assessment answer semantics", () => {
  it("preserves old positives, explicit zero and none without converting unchecked items to absence", () => {
    const old = profile();
    old.home = { heating: "none", backupPower: "none", basement: false };
    old.people[0].needs = [{ kind: "daily-medication", daysSupply: 0 }];
    old.supplies = { waterGallons: 0, foodDays: 4, have: ["first-aid"] };
    const migrated = migrateHousehold(old);
    expect(migrated.people).toEqual(old.people);
    expect(migrated.people[0].absentNeeds).toBeUndefined();
    expect(migrated.home).toEqual(old.home);
    expect(migrated.supplies).toEqual({ ...old.supplies, absent: [] });
    const findings = assessInventory(migrated, { scenario: false });
    expect(findings.find(f => f.rule === "water")).toMatchObject({ status: "short", category: "gap" });
    expect(findings.find(f => f.rule === "smoke-detector")?.category).toBe("unassessed");
    expect(engineBaseline(migrated)).not.toContain("No smoke detectors recorded");
  });

  it.each(["unknown", "skipped", "withheld"] as const)("keeps %s distinct without creating deficiencies or removing independently supported gaps", state => {
    let result = setSupplyAnswer(profile(), "smoke-detector", "absent");
    result.supplies.foodDays = 0;
    result = setSupplyAnswer(result, "first-aid", state);
    expect(result.answers?.["supplies.first-aid"]).toBe(state);
    const findings = assessInventory(result, { scenario: false });
    expect(findings.find(f => f.rule === "smoke-detector")?.category).toBe("gap");
    expect(findings.find(f => f.rule === "food")?.category).toBe("gap");
    const kit = findings.find(f => f.rule === "basic-kit");
    expect(kit?.finding).not.toContain("first aid");
    expect(engineBaseline(result)).not.toContain("first aid kit");
    expect(engineBaseline(result)).not.toContain(`"supplies.first-aid"`);
    if (state !== "unknown") expect(engineBaseline(result)).not.toContain(state);
  });

  it("supports meaningful not-applicable only for formula, without hiding unrelated gaps", () => {
    let result = profile();
    result.people.push({ id: "infant", ageRange: "infant", needs: [] });
    result = setSupplyAnswer(setSupplyAnswer(result, "smoke-detector", "absent"), "formula", "not-applicable");
    expect(assessInventory(result).some(f => f.rule === "infant-formula")).toBe(false);
    expect(assessInventory(result).find(f => f.rule === "smoke-detector")?.category).toBe("gap");
    expect(() => setSupplyAnswer(result, "smoke-detector", "not-applicable")).toThrow();
    expect(engineBaseline(result)).not.toContain("not-applicable");
  });

  it("clearing an absence or positive answer makes only that item unassessed", () => {
    let result = setSupplyAnswer(setSupplyAnswer(profile(), "smoke-detector", "absent"), "co-detector", "present");
    result = setSupplyAnswer(result, "smoke-detector", "skipped");
    expect(assessInventory(result).find(f => f.rule === "smoke-detector")?.category).toBe("unassessed");
    expect(result.supplies.have).toEqual(["co-detector"]);
    result = setSupplyAnswer(result, "co-detector", "withheld");
    expect(result.supplies.have).toEqual([]);
    expect(result.supplies.absent).toEqual([]);
  });

  it("does not interpret unknown backup power as none, but honours explicit none", () => {
    const result = profile();
    result.people[0].needs = [{ kind: "powered-device", watts: 50 }];
    const finding = () => assessInventory(result).find(f => f.rule === "device-power-none");
    expect(finding()?.category).toBe("unassessed");
    expect(engineBaseline(result)).not.toContain("no backup power recorded");
    result.home.backupPower = "none";
    expect(finding()?.category).toBe("gap");
    expect(finding()?.evidence).toContainEqual({ fact: "hasBackupPower", label: "True when backup power other than none is recorded", value: false });
  });

  it("reports zero battery capacity as a confirmed zero-hour shortfall, not an unanswered capacity", () => {
    const result = profile();
    result.people[0].needs = [{ kind: "powered-device", watts: 50 }];
    result.home = { backupPower: "battery", backupWh: 0 };
    const runtimeRule = assessInventory(result).find(f => f.rule === "device-power-hours-short");
    expect(runtimeRule).toMatchObject({ category: "gap", status: "short" });
    expect(runtimeRule?.finding).toContain("0 hours");
    delete result.home.backupWh;
    expect(assessInventory(result).find(f => f.rule === "device-power-runtime")?.category).toBe("unassessed");
    expect(assessInventory(result).some(f => f.category === "gap" && f.finding.includes("0 hours"))).toBe(false);
  });

  it("retains a confirmed cold-chain ice-pack gap regardless of cooler uncertainty", () => {
    for (const cooler of ["skipped", "unknown", "withheld", "absent", "present"] as const) {
      let result = setSupplyAnswer(setSupplyAnswer(profile(), "ice-packs", "absent"), "cooler", cooler);
      result.people[0].needs = [{ kind: "refrigerated-medication" }];
      const finding = assessInventory(result, { scenario: false }).find(f => f.rule === "cold-chain-ice");
      expect(finding).toMatchObject({ category: "gap", status: "missing" });
      expect(finding?.evidence).toContainEqual({ fact: "supplies.ice-packs", label: "Ice packs or frozen water bottles", value: "Explicitly absent" });
      result = setSupplyAnswer(result, "ice-packs", "withheld");
      const cleared = assessInventory(result).find(f => f.rule === "cold-chain-ice");
      expect(cleared?.category).toBe("unassessed");
      expect(cleared?.action).toBeUndefined();
    }
  });

  it.each(["skipped", "unknown", "withheld"] as const)("keeps %s pet weights under unassessed information, never a saved planning deficiency", state => {
    const result = profile();
    result.pets = [{ id: "dog", kind: "dog" }];
    result.answers = { "pet.dog.weightLb": state };
    const findings = assessInventory(result, { scenario: false });
    expect(findings.find(f => f.rule === "pet-weights")?.category).toBe("unassessed");
    expect(findings.find(f => f.rule === "pet-weights")?.action).toBeUndefined();
    expect(findings.find(f => f.rule === "pet-shelter")?.action).toBeTruthy();
  });

  it("deliberately includes explicit supply absences in reviewable briefings, including items without rules, but never local answer metadata", () => {
    let result = profile();
    result.people[0].absentNeeds = ["daily-medication"];
    for (const id of ["fuel", "outdoor-stove", "fire-extinguisher"] as const) result = setSupplyAnswer(result, id, "absent");
    result = setSupplyAnswer(result, "first-aid", "withheld");
    const text = engineBaseline(result);
    expect(text).toContain("Explicitly reported absent: spare fuel for stove or generator, camp stove or grill (outdoor use), fire extinguisher.");
    expect(text).not.toContain("absentNeeds");
    expect(text).not.toContain("daily-medication");
    expect(text).not.toContain("withheld");
    expect(text).not.toContain("first aid kit");
    result = setSupplyAnswer(result, "fuel", "unknown");
    expect(engineBaseline(result)).not.toContain("spare fuel for stove or generator");
  });

  it("keeps a confirmed kit absence while the other kit items are unanswered", () => {
    const result = setSupplyAnswer(profile(), "first-aid", "absent");
    const findings = assessInventory(result, { scenario: false });
    expect(findings.find(f => f.rule === "basic-kit")).toMatchObject({ category: "gap" });
    expect(findings.find(f => f.rule === "basic-kit")?.finding).toContain("first aid kit");
    expect(findings.find(f => f.id === "unassessed-items")).toMatchObject({ category: "unassessed" });
    expect(findings.filter(f => f.id === "unassessed-items")).toHaveLength(1);
    expect(findings.find(f => f.rule === "basic-kit")?.evidence).toContainEqual({
      fact: "supplies.first-aid", label: "First aid kit", value: "Explicitly absent",
    });
  });

  it("uses recorded facts, not an assumed household size, and separates scenario concerns", () => {
    const result = emptyProfile();
    result.supplies.waterGallons = 2;
    expect(assessInventory(result).find(f => f.rule === "water")?.category).toBe("unassessed");
    result.people = profile().people;
    const water = assessInventory(result).find(f => f.rule === "water");
    expect(water?.evidence).toContainEqual({ fact: "water.gallons", label: "Stored water recorded, in gallons", value: 2 });
    result.scenario = "flood";
    expect(assessInventory(result, { scenario: false }).some(f => f.rule === "flood-plan")).toBe(false);
    expect(assessInventory(result).find(f => f.rule === "flood-plan")?.category).toBe("scenario");
  });

  it("never asserts a missing planning arrangement when none has been answered", () => {
    const result = profile();
    result.pets = [{ id: "pet", kind: "dog" }];
    const planning = assessInventory(result, { scenario: false }).filter(f => f.category === "planning");
    expect(planning.some(f => f.rule === "pet-shelter")).toBe(true);
    expect(planning.map(f => f.finding).join("\n")).not.toMatch(/no arrangement|no .*plan recorded/i);
  });
});
