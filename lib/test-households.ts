/**
 * Fictional households for testing, one per design-brief persona plus two
 * edge cases. Each persona also gets a different emergency, so together they
 * cover the main hazards and constraint types. Names, medication and device
 * names are filled in on purpose: they must never appear in what's sent
 * (lib/test-households.test.ts checks this).
 *
 * Used by the wizard's "Load a test household" picker and by
 * scripts/eval/run-households.mjs.
 */
import type { HouseholdProfile } from "@/lib/household";

export interface TestHousehold {
  id: string;
  /** Who this household represents, from docs/product/design-brief.md §2. */
  persona: string;
  /** What this household is meant to stress in the simulation. */
  tests: string;
  profile: HouseholdProfile;
}

export const TEST_HOUSEHOLDS: TestHousehold[] = [
  {
    id: "alex",
    persona: "Alex, the curious newcomer",
    tests:
      "A beginner with almost nothing: one person, a flashlight and a power bank, in an apartment during an outage. Advice should be basic, encouraging and not overwhelming.",
    profile: {
      people: [{ id: "alex-1", localName: "Alex Moreno", ageRange: "adult", needs: [] }],
      pets: [],
      location: { region: "Illinois", setting: "urban" },
      home: {
        type: "apartment",
        floors: 1,
        basement: false,
        heating: "electric",
        cooking: "electric",
        water: "municipal",
        backupPower: "none",
        notes: "Fourth-floor unit in an older building; the elevator stops when the power is out.",
      },
      supplies: { waterGallons: 1, foodDays: 2, have: ["flashlights", "power-bank"] },
      scenario: "power-outage",
    },
  },
  {
    id: "sam",
    persona: "Sam, the household organiser",
    tests:
      "A typical family: two adults, two children (one with asthma) and a large dog in a suburban house with a gas furnace that needs electricity to run, during a winter storm.",
    profile: {
      people: [
        { id: "sam-1", localName: "Sam Okafor", ageRange: "adult", needs: [] },
        { id: "sam-2", localName: "Jamie Okafor", ageRange: "adult", needs: [] },
        { id: "sam-3", localName: "Mateo", ageRange: "child", needs: [{ kind: "air-quality" }] },
        { id: "sam-4", localName: "Lucia", ageRange: "child", needs: [] },
      ],
      pets: [{ id: "sam-pet", localName: "Biscuit", kind: "dog", size: "large", notes: "anxious in storms, pulls on the leash" }],
      location: { region: "Ohio", setting: "suburban" },
      home: {
        type: "house",
        floors: 2,
        basement: true,
        heating: "gas-furnace",
        cooking: "gas",
        water: "municipal",
        backupPower: "none",
        notes: "Attached garage. The kids' bedrooms are upstairs above the garage and get cold first.",
      },
      supplies: {
        waterGallons: 8,
        foodDays: 5,
        petFoodDays: 7,
        have: ["flashlights", "batteries", "first-aid", "smoke-detector", "co-detector", "cooler", "blankets", "can-opener"],
      },
      scenario: "winter-storm",
    },
  },
  {
    id: "priya",
    persona: "Priya, the busy caregiver",
    tests:
      "Caregiving under heat: a nurse on long shifts, her partner, and her mother, who relies on an oxygen concentrator, takes daily medication and needs help on stairs. Tests power budgeting and heat risk for an older adult.",
    profile: {
      people: [
        { id: "priya-1", localName: "Priya Raman", ageRange: "adult", needs: [] },
        { id: "priya-2", localName: "Dev Raman", ageRange: "adult", needs: [] },
        {
          id: "priya-3",
          localName: "Kamala Iyer",
          ageRange: "older-adult",
          needs: [
            { kind: "powered-device", watts: 300, localDetail: "Inogen home oxygen concentrator" },
            { kind: "daily-medication", daysSupply: 6, localDetail: "Lisinopril and metformin" },
            { kind: "stairs" },
            { kind: "hearing" },
          ],
        },
      ],
      pets: [{ id: "priya-pet", localName: "Mango", kind: "bird", size: "small" }],
      location: { region: "Texas", setting: "suburban" },
      home: {
        type: "townhouse",
        floors: 2,
        basement: false,
        heating: "heat-pump",
        cooking: "electric",
        water: "municipal",
        backupPower: "battery",
        backupWatts: 1000,
        notes: "The bedroom for Priya's mother is on the ground floor. West-facing windows; the upstairs gets very hot.",
      },
      supplies: {
        waterGallons: 10,
        foodDays: 4,
        have: ["flashlights", "power-bank", "car-charger", "first-aid", "cooler", "paper-contacts"],
        other: "Two spare oxygen tanks that last about 4 hours each",
      },
      scenario: "heat-wave",
    },
  },
  {
    id: "morgan",
    persona: "Morgan, the community organiser",
    tests:
      "A well-connected household with good communications and a generator that neighbours will lean on. Tests coordination, helping others without overextending, and safe generator use in a hurricane.",
    profile: {
      people: [
        { id: "morgan-1", localName: "Morgan Ellis", ageRange: "adult", needs: [] },
        { id: "morgan-2", localName: "Riley Ellis", ageRange: "adult", needs: [] },
        { id: "morgan-3", localName: "Ash Ellis", ageRange: "teen", needs: [] },
      ],
      pets: [{ id: "morgan-pet", localName: "Pepper", kind: "cat", size: "small" }],
      location: { region: "North Carolina", setting: "suburban" },
      home: {
        type: "house",
        floors: 2,
        basement: false,
        heating: "heat-pump",
        cooking: "electric",
        water: "municipal",
        backupPower: "generator",
        backupWatts: 3500,
        notes: "Morgan coordinates a neighborhood group of 12 homes. Two elderly neighbors live alone on the street, including Mrs. Delgado at number 14.",
      },
      supplies: {
        waterGallons: 20,
        foodDays: 10,
        petFoodDays: 14,
        have: [
          "flashlights", "batteries", "lanterns", "weather-radio", "two-way-radios", "paper-contacts", "whistle",
          "first-aid", "co-detector", "fire-extinguisher", "fuel", "cash", "paper-map", "utility-tools",
        ],
        other: "Neighborhood contact sheet, a shared chainsaw, 10 gallons of stored gasoline",
      },
      scenario: "hurricane",
    },
  },
  {
    id: "jordan",
    persona: "Jordan, the experienced practitioner",
    tests:
      "A well-prepared emergency management volunteer whose supplies don't help much in a wildfire evacuation, with two horses to move. Should be challenged, not congratulated.",
    profile: {
      people: [
        { id: "jordan-1", localName: "Jordan Whitfield", ageRange: "adult", needs: [] },
        { id: "jordan-2", localName: "Casey Whitfield", ageRange: "adult", needs: [{ kind: "pregnant" }] },
      ],
      pets: [
        { id: "jordan-pet-1", localName: "Duke", kind: "horse", size: "large" },
        { id: "jordan-pet-2", localName: "Sable", kind: "horse", size: "large", notes: "hard to load into a trailer" },
        { id: "jordan-pet-3", localName: "Scout", kind: "dog", size: "medium" },
      ],
      location: { region: "California", setting: "rural" },
      home: {
        type: "house",
        floors: 1,
        basement: false,
        heating: "propane",
        cooking: "gas",
        water: "well",
        backupPower: "standby",
        backupWatts: 12000,
        notes: "Ranch at the end of a 2-mile dirt road with one way out. Two-horse trailer; the truck is usually at half a tank.",
      },
      supplies: {
        waterGallons: 60,
        foodDays: 30,
        petFoodDays: 21,
        have: [
          "flashlights", "batteries", "lanterns", "power-bank", "hand-crank", "weather-radio", "two-way-radios",
          "paper-contacts", "whistle", "sleeping-bags", "outdoor-stove", "fuel", "water-filter", "bleach",
          "first-aid", "co-detector", "smoke-detector", "fire-extinguisher", "n95", "utility-tools", "cash",
          "documents", "paper-map",
        ],
        other: "Go-bags for both adults, a ham radio, 500 gallons of propane",
      },
      scenario: "wildfire",
    },
  },
  {
    id: "charlotte",
    persona: "Regional case: inland Carolinas, giant-breed dogs",
    tests:
      "An inland hurricane in the Charlotte area: rain flooding, wind, tornadoes and a long outage rather than storm surge. Two Great Danes test the calorie and water math, and a CPAP on a power station tests battery runtime.",
    profile: {
      people: [
        { id: "charlotte-1", localName: "Marcus Hale", ageRange: "adult", needs: [] },
        {
          id: "charlotte-2",
          localName: "Dana Hale",
          ageRange: "adult",
          needs: [{ kind: "powered-device", watts: 60, localDetail: "AirSense CPAP" }],
        },
      ],
      pets: [
        { id: "charlotte-pet-1", localName: "Atlas", kind: "dog", size: "large", weightLb: 140, notes: "Great Dane" },
        { id: "charlotte-pet-2", localName: "Juno", kind: "dog", size: "large", weightLb: 120, notes: "Great Dane, nervous in storms" },
      ],
      location: { region: "North Carolina", setting: "suburban" },
      home: {
        type: "house",
        floors: 2,
        basement: false,
        heating: "heat-pump",
        cooking: "gas",
        water: "municipal",
        backupPower: "battery",
        backupWatts: 2000,
        backupWh: 2048,
        notes: "Tall oaks over the roof. The creek behind the yard flooded in 2024.",
      },
      supplies: {
        waterGallons: 10,
        foodDays: 7,
        petFoodDays: 10,
        have: ["flashlights", "batteries", "weather-radio", "power-bank", "first-aid", "smoke-detector", "co-detector", "cooler", "can-opener"],
      },
      scenario: "hurricane",
    },
  },
  {
    id: "minimal",
    persona: "Edge case: almost nothing provided",
    tests:
      "Only one adult, everything else skipped. The engine must treat the rest as unknown and find out through injects, not assume.",
    profile: {
      people: [{ id: "minimal-1", ageRange: "adult", needs: [] }],
      pets: [],
      location: {},
      home: {},
      supplies: { have: [] },
      scenario: "surprise",
    },
  },
  {
    id: "privacy",
    persona: "Edge case: personal details in free text",
    tests:
      "Names, a phone number, an address and a medication name typed into free-text notes, where only masking protects them. Nothing in the `leaks` list may reach the server.",
    profile: {
      people: [
        { id: "privacy-1", localName: "Siobhan Byrne", ageRange: "adult", needs: [] },
        {
          id: "privacy-2",
          localName: "Declan Byrne",
          ageRange: "older-adult",
          needs: [{ kind: "refrigerated-medication", daysSupply: 14, localDetail: "Humira" }],
        },
      ],
      pets: [{ id: "privacy-pet", localName: "Rufus", kind: "dog", size: "medium", notes: "Rufus needs his seizure medication twice a day" }],
      location: { region: "Washington", setting: "urban" },
      home: {
        type: "house",
        floors: 2,
        basement: true,
        heating: "electric",
        cooking: "electric",
        water: "municipal",
        backupPower: "none",
        notes: "We live at 4512 W Elm Ave. My brother Ciaran checks on Dad; call him at (206) 555-0142.",
      },
      supplies: { waterGallons: 6, foodDays: 3, have: ["flashlights", "cooler"], other: "Keys are with our neighbor Mrs. Okonkwo" },
      scenario: "earthquake",
    },
  },
];

/** Values in the privacy edge case's free text that masking must catch. */
export const PRIVACY_LEAKS = ["Rufus", "4512 W Elm Ave", "Ciaran", "(206) 555-0142", "Okonkwo"];
