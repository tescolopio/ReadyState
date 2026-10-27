import { beforeEach, describe, expect, it } from "vitest";

import { usePrivacyStore } from "@/store/usePrivacyStore";
import { maskInput, unmaskOutput } from "@/utils/obfuscator";

describe("obfuscator", () => {
  beforeEach(() => usePrivacyStore.getState().clearMappings());

  it("masks people and places and records the mapping", () => {
    const masked = maskInput("John Smith and Mary went to Paris.");

    expect(masked).toBe("[Person 1] and [Person 2] went to [Location 1].");
    expect(usePrivacyStore.getState().entityMap).toEqual({
      "[Person 1]": "John Smith",
      "[Person 2]": "Mary",
      "[Location 1]": "Paris",
    });
  });

  it("reuses existing tags for repeated entities across calls", () => {
    maskInput("Sarah Connor is stuck in Houston.");
    const masked = maskInput("Sarah Connor needs to leave Houston now.");

    expect(masked).toBe("[Person 1] needs to leave [Location 1] now.");
    expect(Object.keys(usePrivacyStore.getState().entityMap)).toHaveLength(2);
  });

  it("leaves text without entities and existing tags untouched", () => {
    const text = "[Adult 1] has a [Large Dog] and 3 gallons of water.";
    expect(maskInput(text)).toBe(text);
    expect(usePrivacyStore.getState().entityMap).toEqual({});
  });

  it("unmasks tags in AI output and ignores unknown tags", () => {
    maskInput("John Smith lives in Seattle.");
    expect(
      unmaskOutput("[Person 1] loses power in [Location 1]; [Adult 2] is fine."),
    ).toBe("John Smith loses power in Seattle; [Adult 2] is fine.");
  });

  it("round-trips masked text", () => {
    const original = "Mary drove from Denver to Boulder with John Smith.";
    expect(unmaskOutput(maskInput(original))).toBe(original);
  });

  it("clearMappings empties the ledger", () => {
    maskInput("John Smith lives in Seattle.");
    usePrivacyStore.getState().clearMappings();
    expect(usePrivacyStore.getState().entityMap).toEqual({});
    expect(unmaskOutput("[Person 1]")).toBe("[Person 1]");
  });
});
