import { describe, expect, it } from "vitest";

import { countedWater, emptyGuidedAssessment, guidedAssessmentSchema, waterReviewKey, waterTopicStatus } from "@/lib/guided-water";
import { emptyProfile, withAnswer } from "@/lib/household";
import { localRecordsSchema, emptyLocalRecords } from "@/lib/local-records";

describe("guided water helper and topic state", () => {
  it("calculates quantities, not recommended supplies; full US gallons are exact and metric containers convert", () => {
    expect(countedWater({ bottle500: "", bottle1000: "", gallon1: "2", gallon5: "1" })).toEqual({ litres: 7 * 3.785411784, gallons: 7 });
    expect(countedWater({ bottle500: "2", bottle1000: "1", gallon1: "", gallon5: "" }).gallons).toBeCloseTo(2 / 3.785411784, 12);
    expect(countedWater(emptyGuidedAssessment().counts)).toEqual({ litres: 0, gallons: 0 });
    for (const invalid of ["-1", "1.5", "1e2", "1000000", "NaN", "Infinity"]) {
      expect(() => countedWater({ ...emptyGuidedAssessment().counts, gallon1: invalid })).toThrow();
    }
  });

  it("distinguishes review progress from readiness and invalidates review on relevant edits", () => {
    const profile = emptyProfile();
    expect(waterTopicStatus(profile, null)).toBe("Not started");
    expect(waterTopicStatus(profile, null, true)).toBe("Started");
    const unknown = withAnswer(profile, "supplies.waterGallons", "unknown");
    expect(waterTopicStatus(unknown, null)).toBe("Needs a few answers");
    expect(waterTopicStatus(unknown, waterReviewKey(unknown))).toBe("Reviewed");
    const changed = { ...unknown, people: [{ id: "adult", needs: [] }] };
    expect(waterTopicStatus(changed, waterReviewKey(unknown))).toBe("Needs review");
    expect(waterTopicStatus({ ...profile, supplies: { have: [], waterGallons: 0 } }, null)).toBe("Needs a few answers");
  });

  it("reads prior backup/history records and preserves new guided state in the shared full backup payload", () => {
    const old = emptyLocalRecords();
    expect(localRecordsSchema.parse(old)).toEqual(old);
    const guidedAssessment = { ...emptyGuidedAssessment(), mode: "guided" as const, screen: "water" as const };
    expect(localRecordsSchema.parse({ ...old, guidedAssessment }).guidedAssessment).toEqual(guidedAssessment);
    expect(guidedAssessmentSchema.safeParse({ ...guidedAssessment, readinessScore: 100 }).success).toBe(false);
  });
});
