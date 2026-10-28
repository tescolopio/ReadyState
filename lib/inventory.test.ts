import { describe, expect, it } from "vitest";

import { emptyProfile } from "@/lib/household";
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
      action: "Store about 4 more gallons (1 gallon per person per day, plus extra for pets).",
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
    expect(byId(priya, "priya-3-device-power")).toMatchObject({ status: "partial" });
    expect(byId(priya, "priya-3-device-power")?.finding).toContain("about 7.2 kWh a day");
    expect(byId(priya, "priya-3-stairs")?.kind).toBe("plan");
  });

  it("needs a CO detector only where something burns fuel", () => {
    const withoutDetector = (heating: "gas-furnace" | "electric") =>
      byId(assessInventory({ ...emptyProfile(), home: { heating }, supplies: { have: [] } }), "co-detector");
    expect(withoutDetector("gas-furnace")?.status).toBe("missing");
    expect(withoutDetector("electric")).toBeUndefined();
    // Sam has a gas furnace and a CO detector.
    expect(byId(assessInventory(household("sam")), "co-detector")).toBeUndefined();
  });

  it("checks the cold chain for refrigerated medication", () => {
    expect(byId(assessInventory(household("privacy")), "privacy-2-cold-chain")).toMatchObject({
      status: "missing",
      finding: "Person 2 (older adult (65+)): medication that must stay refrigerated: no ice packs recorded to keep it cold without power.",
    });
  });

  it("adds checks for the chosen emergency and the home", () => {
    const jordan = assessInventory(household("jordan"));
    expect(byId(jordan, "well-pump")?.status).toBe("ok");
    expect(byId(jordan, "pet-shelter")?.kind).toBe("plan");
    expect(byId(assessInventory(household("alex")), "warmth")?.status).toBe("missing");
  });

  it("lists the basic kit items that are missing", () => {
    expect(byId(assessInventory(household("alex")), "basic-kit")?.finding).toBe(
      "Missing 10 of 12 basic kit items: a battery or hand-crank radio with NOAA weather alerts, a first aid kit, extra batteries, a whistle, dust masks, plastic sheeting and duct tape, moist towelettes, garbage bags and ties, a wrench or pliers to turn off utilities, a manual can opener, local maps.",
    );
  });

  it("puts the worst gaps first and marks unrecorded supplies to check", () => {
    const findings = assessInventory(household("minimal"));
    expect(findings[0].status).toBe("missing");
    expect(byId(findings, "water")?.status).toBe("unknown");
    expect(gaps(findings).every((finding) => finding.status !== "ok")).toBe(true);
  });
});

describe("engineBaseline", () => {
  it("adds the inventory gaps, but not unrecorded items, to what the engine sees", () => {
    const text = engineBaseline(household("sam"));
    expect(text).toContain("Gaps found by the inventory check (test these in the exercise): Stored water covers about 2 days");
    expect(describeGaps(assessInventory(household("minimal")))).not.toContain("not recorded");
  });
});
