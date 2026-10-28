import { beforeEach, describe, expect, it } from "vitest";

import { describeHousehold, privateTerms } from "@/lib/household";
import { PRIVACY_LEAKS, TEST_HOUSEHOLDS } from "@/lib/test-households";
import { usePrivacyStore } from "@/store/usePrivacyStore";
import { maskInput } from "@/utils/obfuscator";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const containsWord = (text: string, word: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, "iu").test(text);

/** Exactly what the wizard sends for a profile. */
const outgoing = (id: string) => {
  const { profile } = TEST_HOUSEHOLDS.find((household) => household.id === id)!;
  return maskInput(describeHousehold(profile), { alwaysMask: privateTerms(profile), dryRun: true });
};

describe("test households", () => {
  beforeEach(() => usePrivacyStore.getState().clearMappings());

  it.each(TEST_HOUSEHOLDS.map((household) => [household.id, household] as const))(
    "%s sends no names, medication or device names",
    (id, { profile }) => {
      const text = outgoing(id);
      expect(privateTerms(profile).filter((term) => containsWord(text, term)), text).toEqual([]);
    },
  );

  it("masks personal details typed into free-text notes", () => {
    const text = outgoing("privacy");
    expect(PRIVACY_LEAKS.filter((leak) => containsWord(text, leak)), text).toEqual([]);
  });

  it("covers all five personas, each with a different emergency", () => {
    const personas = TEST_HOUSEHOLDS.filter((household) => !household.id.match(/minimal|privacy/));
    expect(personas.map((household) => household.id)).toEqual(["alex", "sam", "priya", "morgan", "jordan"]);
    expect(new Set(personas.map((household) => household.profile.scenario)).size).toBe(5);
  });

  it("reports skipped sections as unknown for the minimal household", () => {
    expect(outgoing("minimal")).toContain("Not provided: general location, home and utilities, supplies.");
  });

  it("keeps the details the simulation needs", () => {
    const priya = outgoing("priya");
    expect(priya).toContain("[Hardware Power Dependent] (about 300 W)");
    expect(priya).toContain("Backup power: portable power station (about 1000 W).");
    expect(priya).toContain("Emergency to practice: heat wave.");
    expect(outgoing("jordan")).toContain("Pets: 2 large horses, 1 medium dog.");
  });
});
