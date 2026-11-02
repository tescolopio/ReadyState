import { describe, expect, it } from "vitest";

import { emptyProfile, setSupplyAnswer, SUPPLY_ITEMS, type SupplyId } from "@/lib/household";
import { assessInventory, describeGaps, engineBaseline, gaps, type Finding } from "@/lib/inventory";
import { TEST_HOUSEHOLDS } from "@/lib/test-households";

const household = (id: string) => TEST_HOUSEHOLDS.find((h) => h.id === id)!.profile;
const byId = (findings: Finding[], id: string) => findings.find((finding) => finding.id === id);

describe("assessInventory", () => {
  it("scales water to the household and grades it against 3 days and 2 weeks", () => {
    // Sam: 8 gallons for 4 people is 2 days.
    expect(byId(assessInventory(household("sam")), "water")).toMatchObject({
      status: "short",
      finding: "Stored water covers about 2 days, below the 3-day minimum.",
      action: "Store about 4 more gallons: the household uses about 4 gallons a day (1 gallon per person); add your pets' weights to include their water.",
    });
    // Morgan: 20 gallons for 3 people is 6.7 days.
    expect(byId(assessInventory(household("morgan")), "water")?.status).toBe("partial");
    // Jordan: 60 gallons for 2 people is 30 days.
    expect(byId(assessInventory(household("jordan")), "water")?.status).toBe("ok");
  });

  it("flags medication under a week and a powered device without backup", () => {
    const priya = assessInventory(household("priya"));
    expect(byId(priya, "priya-3-daily-medication")).toMatchObject({
      status: "short",
      finding: "Person 3 (older adult (65+)): daily medication they can't skip: about 6 days on hand, below the recommended 7 to 10.",
    });
    // Priya has a power station, so the device check asks about runtime.
    expect(byId(priya, "priya-3-device-power")).toMatchObject({ status: "unknown", category: "unassessed" });
    expect(byId(priya, "priya-3-device-power")?.evidence).toContainEqual({
      fact: "need.kwhPerDay", label: "Device energy per day in kWh, from its watts", value: "7.2",
    });
    expect(byId(priya, "priya-3-stairs")?.kind).toBe("plan");
  });

  it("needs a CO detector only where something burns fuel", () => {
    const withoutDetector = (heating: "gas-furnace" | "electric") =>
      byId(assessInventory({ ...emptyProfile(), home: { heating, cooking: "electric", backupPower: "none" }, supplies: { have: [], absent: ["co-detector"] } }), "co-detector");
    expect(withoutDetector("gas-furnace")?.status).toBe("missing");
    expect(withoutDetector("electric")).toBeUndefined();
    // Sam has a gas furnace and a CO detector.
    expect(byId(assessInventory(household("sam")), "co-detector")).toBeUndefined();
  });

  it("checks the cold chain for refrigerated medication", () => {
    expect(byId(assessInventory(setSupplyAnswer(household("privacy"), "ice-packs", "absent")), "privacy-2-cold-chain")).toMatchObject({
      status: "missing",
      finding: "Person 2 (older adult (65+)): medication that must stay refrigerated: no ice packs recorded to keep it cold without power.",
    });
  });

  it("adds checks for the chosen emergency and the home", () => {
    const jordan = assessInventory(household("jordan"));
    expect(byId(jordan, "well-pump")?.status).toBe("ok");
    expect(byId(jordan, "pet-shelter")?.kind).toBe("plan");
    const cold = setSupplyAnswer(setSupplyAnswer(household("alex"), "blankets", "absent"), "sleeping-bags", "absent");
    expect(byId(assessInventory(cold), "warmth")?.status).toBe("missing");
  });

  it("lists the basic kit items that are missing", () => {
    let profile = household("alex");
    for (const id of Object.keys(Object.assign({}, ...Object.values(SUPPLY_ITEMS))) as SupplyId[]) {
      if (!profile.supplies.have.includes(id)) profile = setSupplyAnswer(profile, id, "absent");
    }
    expect(byId(assessInventory(profile), "basic-kit")?.finding).toBe(
      "Missing 10 of 12 basic kit items: a battery or hand-crank radio with NOAA weather alerts, a first aid kit, extra batteries, a whistle, dust masks, plastic sheeting and duct tape, moist towelettes, garbage bags and ties, a wrench or pliers to turn off utilities, a manual can opener, local maps.",
    );
  });

  it("puts the worst gaps first and marks unrecorded supplies to check", () => {
    const findings = assessInventory(household("minimal"));
    expect(findings.every(finding => finding.category !== "gap")).toBe(true);
    expect(byId(findings, "water")?.status).toBe("unknown");
    expect(gaps(findings).every((finding) => finding.status !== "ok")).toBe(true);
  });
});

describe("engineBaseline", () => {
  it("adds the inventory gaps, but not unrecorded items, to what the engine sees", () => {
    const text = engineBaseline(household("sam"));
    expect(text).toContain("Gaps found by the inventory check (test these in the exercise): Stored water covers about 2 days");
    expect(describeGaps(assessInventory(household("minimal")))).toBeUndefined();
  });
});

describe("inventory math", () => {
  const charlotte = assessInventory(household("charlotte"));

  it("adds pets' water to the household's daily need", () => {
    // 2 people × 1 gal + (140 + 120 lb) × 1 oz/lb ÷ 128 oz/gal ≈ 4.0 gal/day; 10 gal ≈ 2.5 days.
    expect(byId(charlotte, "water")).toMatchObject({
      status: "short",
      finding: "Stored water covers about 2.4 days, below the 3-day minimum.",
      action: "Store about 3 more gallons: the household uses about 4 gallons a day (1 gallon per person, plus about 2.0 for pets).",
    });
  });

  it("estimates people's and pets' calories", () => {
    // Adults 2 × 2,200; Great Danes 70 × kg^0.75 × 1.6: 140 lb ≈ 2,520, 120 lb ≈ 2,245.
    expect(byId(charlotte, "calorie-needs")?.finding).toBe(
      "The household needs about 4,400 kcal a day: about 13,200 for 3 days and 61,600 for 2 weeks, plus about 4,764 kcal a day for the pets.",
    );
    expect(byId(charlotte, "pet-food")?.action).toContain("Your pets need about 4,764 kcal a day");
  });

  it("works out how long the battery runs a medical device", () => {
    // 2,048 Wh × 85% ÷ 60 W ≈ 29 hours.
    expect(byId(charlotte, "charlotte-2-device-power")).toMatchObject({
      status: "partial",
      finding: "Person 2 (adult): medical device that needs power: the recorded battery runs it for about 29 hours.",
    });
  });

  it("plans for toilets, tornadoes and inland flooding in a hurricane", () => {
    expect(byId(charlotte, "toilet-plan")?.category).toBe("unassessed");
    expect(byId(assessInventory(setSupplyAnswer(household("charlotte"), "toilet-kit", "absent")), "toilet-plan")?.status).toBe("partial");
    expect(byId(charlotte, "tornado-plan")?.kind).toBe("plan");
    expect(byId(charlotte, "hurricane-plan")?.finding).toContain("rain flooding now causes most US hurricane deaths");
  });

  it("asks for pet weights when they're missing", () => {
    expect(byId(assessInventory(household("sam")), "pet-weights")?.status).toBe("unknown");
    expect(byId(charlotte, "pet-weights")).toBeUndefined();
  });
});
