import { describe, expect, it } from "vitest";
import { waterDisplay, waterInput } from "@/lib/water-display";
import { emptyProfile } from "@/lib/household";
import { assessInventory } from "@/lib/inventory";

describe("water display without changing stored precision", () => {
  it("never rounds a quantity or duration up to a threshold", () => {
    expect(waterDisplay(2.999999)).toBe("2.999");
    expect(waterDisplay(13.999999, 2)).toBe("13.99");
    expect(waterDisplay(0)).toBe("0");
    expect(waterDisplay(0.00001)).toBe("less than 0.001");
    expect(waterInput(undefined)).toBe("");
    expect(waterInput(2.2641720523581483)).toBe("2.264");
    for (const [amount, status, duration] of [[2.999999, "short", "2.9 days"], [13.999999, "partial", "13.9 days"], [3, "partial", "3 days"], [14, "ok", "14 days"]] as const) {
      const profile = { ...emptyProfile(), people: [{ id: "adult", needs: [] }], supplies: { have: [], waterGallons: amount } };
      const finding = assessInventory(profile, { scenario: false }).find(item => item.rule === "water")!;
      expect(finding.status).toBe(status);
      expect(finding.finding).toContain(duration);
      expect(profile.supplies.waterGallons).toBe(amount);
    }
  });

  it("names the missing home-system information independently of known water", () => {
    const profile = { ...emptyProfile(), people: [{ id: "adult", needs: [] }], supplies: { have: [], waterGallons: 14 } };
    const findings = assessInventory(profile, { scenario: false });
    expect(findings.find(item => item.rule === "water")?.category).toBe("recorded");
    expect(findings.find(item => item.rule === "well-pump")?.finding).toContain("water source is unanswered");
    expect(assessInventory({ ...profile, home: { water: "well" } }, { scenario: false }).find(item => item.rule === "well-pump")?.finding).toContain("backup power is unanswered");
    expect(assessInventory({ ...profile, supplies: { have: [] } }, { scenario: false }).find(item => item.rule === "water")?.finding).toContain("stored quantity is unanswered");
  });
});
