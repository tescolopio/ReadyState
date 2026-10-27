import { beforeEach, describe, expect, it } from "vitest";

import { usePrivacyStore } from "@/store/usePrivacyStore";
import { MASKING_CORPUS } from "@/utils/masking-corpus";
import { maskInput, unmaskOutput } from "@/utils/obfuscator";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word, case-insensitive, so "Mai" doesn't match inside "Maine". */
const containsWord = (text: string, word: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, "iu").test(text);

describe("masking corpus", () => {
  beforeEach(() => usePrivacyStore.getState().clearMappings());

  it.each(MASKING_CORPUS.map((c, i) => [i + 1, c] as const))(
    "case %i sends no known PII and keeps what the simulation needs",
    (_, { text, pii, keep = [] }) => {
      const masked = maskInput(text);
      expect(pii.filter((value) => containsWord(masked, value)), masked).toEqual([]);
      expect(keep.filter((value) => !containsWord(masked, value)), masked).toEqual([]);
      expect(unmaskOutput(masked)).toBe(text);
    },
  );

  it("has at least 50 cases", () => {
    expect(MASKING_CORPUS.length).toBeGreaterThanOrEqual(50);
  });
});

describe("masking details", () => {
  beforeEach(() => {
    usePrivacyStore.getState().clearMappings();
    usePrivacyStore.getState().setAlwaysMask([]);
  });

  it("tags pets as pets, not people", () => {
    expect(maskInput("Our dog Max and my wife Priya.")).toBe("Our dog [Pet 1] and my wife [Person 1].");
  });

  it("tags contact details by kind", () => {
    expect(maskInput("Call 303-555-0142 or email a.b@example.com, ZIP 80203.")).toBe(
      "Call [Phone 1] or email [Email 1], ZIP [Postcode 1].",
    );
  });

  it("keeps quantities that look like ZIP codes", () => {
    const text = "A 10000 mAh battery and a 12000 BTU heater.";
    expect(maskInput(text)).toBe(text);
  });

  it("keeps masking names from earlier messages without context", () => {
    maskInput("My wife Priya is diabetic.");
    expect(maskInput("Priya checks her glucose.")).toBe("[Person 1] checks her glucose.");
  });

  it("masks names on the always-mask list", () => {
    usePrivacyStore.getState().setAlwaysMask(["Zorblax", " ", "Zorblax"]);
    expect(usePrivacyStore.getState().alwaysMask).toEqual(["Zorblax"]);
    expect(maskInput("zorblax has the radio.")).toBe("[Person 1] has the radio.");
  });

  it("accepts an always-mask list per call", () => {
    expect(maskInput("Quillon has the radio.", { alwaysMask: ["Quillon"] })).toBe(
      "[Person 1] has the radio.",
    );
  });
});

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
