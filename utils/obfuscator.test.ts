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

  it("previews masking without touching the ledger", () => {
    maskInput("My wife Priya is diabetic.");
    expect(maskInput("Priya and our dog Max.", { dryRun: true })).toBe("[Person 1] and our dog [Pet 1].");
    expect(usePrivacyStore.getState().entityMap).toEqual({ "[Person 1]": "Priya" });
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

describe("masking regressions from the test households", () => {
  beforeEach(() => usePrivacyStore.getState().clearMappings());

  it("doesn't read a counted noun as a name with an age", () => {
    expect(maskInput("People (4): 2 adults.")).toBe("People (4): 2 adults.");
  });

  it("doesn't extend a name with a word from the next line", () => {
    expect(maskInput("Keys are with our neighbor Mrs. Okonkwo\nEmergency to practice: earthquake.")).toBe(
      "Keys are with our neighbor [Person 1]\nEmergency to practice: earthquake.",
    );
  });

  it("keeps a phone number's brackets inside the tag", () => {
    expect(maskInput("Call him at (206) 555-0142.")).toBe("Call him at [Phone 1].");
  });
});

describe("masking regressions from the guidance text", () => {
  beforeEach(() => usePrivacyStore.getState().clearMappings());

  it("doesn't read an abbreviation after a capitalized word as a city and state", () => {
    expect(maskInput("Battery CO detectors near sleeping areas.")).toBe("Battery CO detectors near sleeping areas.");
    expect(maskInput("We moved to Denver CO 80203 last year.")).toBe("We moved to [Location 1] CO [Postcode 1] last year.");
  });
});

describe("masking fixes from the PR 18 review", () => {
  beforeEach(() => usePrivacyStore.getState().clearMappings());

  it("masks a name's words only in their own capitalization, so common words stay readable", () => {
    const alwaysMask = [
      { value: "Ash Ellis", kind: "Person" as const },
      { value: "Ash", kind: "Person" as const, caseSensitive: true },
      { value: "Ellis", kind: "Person" as const, caseSensitive: true },
    ];
    expect(maskInput("The ash is falling on the car.", { alwaysMask })).toBe("The ash is falling on the car.");
    // The full name always takes [Person 1]; the first name gets its own tag once it appears.
    expect(maskInput("Ash packs the go-bag.", { alwaysMask })).toBe("[Person 2] packs the go-bag.");
    // A later message, with the word now in the ledger, still leaves the ordinary word alone.
    expect(maskInput("More ash tonight; Ash stays inside.", { alwaysMask })).toBe("More ash tonight; [Person 2] stays inside.");
  });

  it("tags medical details as medical, not as people", () => {
    expect(maskInput("Give him his Humira tonight.", { alwaysMask: [{ value: "Humira", kind: "Medical" }] })).toBe("Give him his [Medical 1] tonight.");
  });

  it("still masks a city before an unambiguous state code or after a comma", () => {
    expect(maskInput("We live in Austin TX with two kids.")).toBe("We live in [Location 1] TX with two kids.");
    expect(maskInput("We're near Salem, OR and the coast.")).toBe("We're near [Location 2], OR and the coast.");
  });
});
