import { describe, expect, it } from "vitest";

import { describeHousehold, emptyProfile, hasProfile, type HouseholdProfile } from "@/lib/household";

const sam: HouseholdProfile = {
  ...emptyProfile(),
  people: [
    { id: "a", localName: "Sam", ageRange: "adult", needs: [] },
    {
      id: "b",
      localName: "Priya",
      ageRange: "adult",
      needs: [{ kind: "refrigerated-medication", daysSupply: 14, localDetail: "Humalog" }],
    },
    { id: "c", localName: "Linh", ageRange: "child", needs: [] },
    {
      id: "d",
      localName: "Grandpa Ernesto",
      ageRange: "older-adult",
      needs: [{ kind: "powered-device", watts: 60, localDetail: "ResMed CPAP" }, { kind: "stairs" }],
    },
  ],
  pets: [{ id: "p", localName: "Max", kind: "dog", size: "large", notes: "afraid of thunder" }],
  location: { region: "Colorado", setting: "suburban" },
  home: { type: "house", floors: 2, basement: true, heating: "gas-furnace", cooking: "gas", water: "municipal", backupPower: "none" },
  supplies: { waterGallons: 12, foodDays: 7, have: ["flashlights", "weather-radio", "cooler"] },
  scenario: "winter-storm",
};

describe("describeHousehold", () => {
  it("describes people by age range and needs, never by name or medication", () => {
    const text = describeHousehold(sam);
    expect(text).toContain("People (4): 2 adults, 1 child (2–12), 1 older adult (65+).");
    expect(text).toContain("Person 2 (adult): [Refrigerated Medication Dependent] (14 days of supply on hand).");
    expect(text).toContain("[Hardware Power Dependent] (about 60 W); needs help with stairs and carrying.");
    for (const local of ["Sam", "Priya", "Linh", "Ernesto", "Max", "Humalog", "ResMed"]) {
      expect(text).not.toContain(local);
    }
  });

  it("summarizes the home, pets, supplies and the chosen emergency", () => {
    const text = describeHousehold(sam);
    expect(text).toContain("Pets: 1 large dog.\n- large dog: afraid of thunder");
    expect(text).toContain("Location: Colorado, suburban.");
    expect(text).toContain(
      "Home: house, 2 floors, basement. Heating: natural gas furnace. Cooking: gas. Water: municipal water. Backup power: none.",
    );
    expect(text).toContain("12 gallons of stored water (about 3.0 days at 1 gallon per person per day, before pets)");
    expect(text).toContain("Has: flashlights or headlamps, battery or hand-crank weather radio, cooler.");
    expect(text).toContain("Emergency to practice: winter storm.");
    expect(text).not.toContain("Not provided");
  });

  it("reports skipped sections as unknown instead of assuming them", () => {
    const text = describeHousehold({ ...emptyProfile(), people: [{ id: "a", ageRange: "adult", needs: [] }] });
    expect(text).toContain(
      "Not provided: general location, home and utilities, supplies. Treat these as unknown; don't assume them.",
    );
    expect(text).toContain("choose one that fits the location and season");
  });

  it("knows when there's enough to start", () => {
    expect(hasProfile(emptyProfile())).toBe(false);
    expect(hasProfile(sam)).toBe(true);
  });
});

describe("describeHousehold plurals", () => {
  it("pluralizes people and pets", () => {
    const text = describeHousehold({
      ...emptyProfile(),
      people: [
        { id: "a", ageRange: "child", needs: [] },
        { id: "b", ageRange: "child", needs: [] },
        { id: "c", needs: [] },
        { id: "d", needs: [] },
      ],
      pets: [
        { id: "p", kind: "dog", size: "large" },
        { id: "q", kind: "dog", size: "large" },
        { id: "r", kind: "livestock" },
        { id: "s", kind: "livestock" },
      ],
    });
    expect(text).toContain("People (4): 2 children (2–12), 2 people of unknown age.");
    expect(text).toContain("Pets: 2 large dogs, 2 livestock.");
  });
});
