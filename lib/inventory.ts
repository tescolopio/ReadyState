/**
 * Inventory check: compares a household profile with published preparedness
 * guidance, without the model. Runs after the household build (wizard Review
 * step), and its gaps are sent with the household summary so the exercise
 * can explore them.
 *
 * Thresholds, to be confirmed as knowledge-base records (work item R3):
 * - Water: 1 gallon per person per day; at least 3 days, ideally 2 weeks at
 *   home (Ready.gov, Build a Kit).
 * - Food: at least 3 days of non-perishable food; 2 weeks at home (Ready.gov).
 * - Pets: food and water for at least 3 days (Ready.gov, Pets).
 * - Medication: at least a 7-day supply (CDC emergency preparedness guidance).
 * - Basic kit items: Ready.gov's Build a Kit list.
 * - CO detector where fuel-burning appliances or generators are present (CDC).
 */
import {
  AGE_RANGES,
  NEED_INFO,
  describeHousehold,
  type HouseholdProfile,
  type Person,
  type SupplyId,
} from "@/lib/household";

export type FindingStatus = "missing" | "short" | "partial" | "unknown" | "ok";
/** "get" is something to acquire; "plan" is a decision or arrangement to make. */
export type FindingKind = "get" | "plan";

export interface Finding {
  id: string;
  area: "Water" | "Food" | "Pets" | "Medical" | "Power" | "Safety" | "Kit" | "Plan";
  status: FindingStatus;
  /** What the check found, in plain language. */
  finding: string;
  /** What to do about it, for the action plan. */
  action?: string;
  kind: FindingKind;
}

export const MIN_DAYS = 3;
export const HOME_DAYS = 14;
export const MEDICATION_DAYS = 7;

/** Ready.gov basic kit items this app tracks, beyond water and food. */
const BASIC_KIT: Partial<Record<SupplyId, string>> = {
  "weather-radio": "a battery or hand-crank weather radio",
  flashlights: "flashlights",
  batteries: "spare batteries",
  "first-aid": "a first aid kit",
  whistle: "a whistle",
  n95: "N95 masks",
  "utility-tools": "a wrench to shut off utilities",
  "can-opener": "a manual can opener",
  "paper-map": "a paper map",
  "power-bank": "a phone power bank",
};

const STATUS_ORDER: Record<FindingStatus, number> = { missing: 0, short: 1, partial: 2, unknown: 3, ok: 4 };

const days = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)} day${value === 1 ? "" : "s"}`;

/** "Person 3 (older adult (65+))", matching describeHousehold's labels. */
const who = (person: Person, index: number) =>
  `Person ${index + 1}${person.ageRange ? ` (${AGE_RANGES[person.ageRange]})` : ""}`;

/** Grades a days-of-supply figure against the 3-day minimum and 2-week home goal. */
function supplyFinding(
  id: string,
  area: Finding["area"],
  label: string,
  covered: number | undefined,
  action: (shortBy: number) => string,
): Finding {
  if (covered === undefined) {
    return { id, area, kind: "get", status: "unknown", finding: `${label}: not recorded.`, action: `Count your ${label.toLowerCase()}.` };
  }
  if (covered < MIN_DAYS) {
    return { id, area, kind: "get", status: "short", finding: `${label} covers about ${days(covered)}, below the ${MIN_DAYS}-day minimum.`, action: action(MIN_DAYS - covered) };
  }
  if (covered < HOME_DAYS) {
    return { id, area, kind: "get", status: "partial", finding: `${label} covers about ${days(covered)}: enough for ${MIN_DAYS} days, short of the 2-week goal for staying home.`, action: action(HOME_DAYS - covered) };
  }
  return { id, area, kind: "get", status: "ok", finding: `${label} covers about ${days(covered)}.` };
}

export function assessInventory(profile: HouseholdProfile): Finding[] {
  const { people, pets, home, supplies, scenario } = profile;
  const has = (item: SupplyId) => supplies.have.includes(item);
  const findings: Finding[] = [];

  // Water and food, scaled to the household.
  const headcount = Math.max(1, people.length);
  const waterDays = supplies.waterGallons === undefined ? undefined : supplies.waterGallons / headcount;
  findings.push(
    supplyFinding("water", "Water", "Stored water", waterDays, (shortBy) =>
      `Store about ${Math.ceil(shortBy * headcount)} more gallons (1 gallon per person per day${pets.length ? ", plus extra for pets" : ""}).`,
    ),
    supplyFinding("food", "Food", "Food", supplies.foodDays, (shortBy) =>
      `Add about ${days(Math.ceil(shortBy))} more of non-perishable food that needs no cooking.`,
    ),
  );
  if (home.water === "well") {
    findings.push({
      id: "well-pump",
      area: "Water",
      kind: "plan",
      status: home.backupPower && home.backupPower !== "none" ? "ok" : "partial",
      finding: "A well pump stops without power, so tap water stops in an outage.",
      action: "Store more water, or plan backup power that can run the pump safely.",
    });
  }

  if (pets.length) {
    findings.push(
      supplyFinding("pet-food", "Pets", "Pet food", supplies.petFoodDays, (shortBy) =>
        `Add about ${days(Math.ceil(shortBy))} more of pet food, and water for them too.`,
      ),
      {
        id: "pet-shelter",
        area: "Pets",
        kind: "plan",
        status: "unknown",
        finding: "Many emergency shelters don't accept pets.",
        action: "Find pet-friendly shelters, hotels or friends along your evacuation route.",
      },
    );
  }

  // Medical needs, per person.
  people.forEach((person, index) => {
    for (const need of person.needs) {
      const info = NEED_INFO[need.kind];
      const label = `${who(person, index)}: ${info.label.toLowerCase()}`;
      if (info.asks === "days") {
        if (need.daysSupply === undefined) {
          findings.push({ id: `${person.id}-${need.kind}`, area: "Medical", kind: "get", status: "unknown", finding: `${label}: days of supply not recorded.`, action: "Count how many days of this medication you have." });
        } else if (need.daysSupply < MEDICATION_DAYS) {
          findings.push({ id: `${person.id}-${need.kind}`, area: "Medical", kind: "get", status: "short", finding: `${label}: about ${days(need.daysSupply)} on hand, below the recommended ${MEDICATION_DAYS}.`, action: "Ask the pharmacist or prescriber about an emergency supply or an early refill." });
        } else {
          findings.push({ id: `${person.id}-${need.kind}`, area: "Medical", kind: "get", status: "ok", finding: `${label}: about ${days(need.daysSupply)} on hand.` });
        }
      }
      if (need.kind === "refrigerated-medication" && !(has("cooler") && has("ice-packs"))) {
        findings.push({
          id: `${person.id}-cold-chain`,
          area: "Medical",
          kind: "get",
          status: "missing",
          finding: `${label}: no ${has("cooler") ? "ice packs" : "cooler"} recorded to keep it cold without power.`,
          action: "Keep a cooler and ice packs (or frozen water bottles) for medication, and a fridge thermometer.",
        });
      }
      if (need.kind === "powered-device") {
        const backup = home.backupPower && home.backupPower !== "none";
        const perDay = need.watts ? ` It needs about ${((need.watts * 24) / 1000).toFixed(1)} kWh a day.` : "";
        findings.push({
          id: `${person.id}-device-power`,
          area: "Power",
          kind: "get",
          status: backup ? "partial" : "missing",
          finding: backup
            ? `${label}: backup power is recorded; check how many hours it runs the device.${perDay}`
            : `${label}: no backup power recorded.${perDay}`,
          action: backup
            ? "Check your backup's capacity in watt-hours against the device, and test it under load."
            : "Get a battery backup sized for the device, and ask the manufacturer about battery options.",
        });
        findings.push({
          id: `${person.id}-utility-list`,
          area: "Plan",
          kind: "plan",
          status: "unknown",
          finding: `${label}: power companies can't restore power faster for one home, but many keep a list of customers who rely on medical equipment.`,
          action: "Ask your power company about its medical-needs program, and plan where to go if an outage lasts longer than the battery.",
        });
      }
      if (need.kind === "stairs" && (home.floors ?? 1) > 1) {
        findings.push({
          id: `${person.id}-stairs`,
          area: "Plan",
          kind: "plan",
          status: "unknown",
          finding: `${label}, in a ${home.floors}-floor home.`,
          action: "Plan where they sleep and how they get out quickly, and who helps.",
        });
      }
    }
  });

  // Safety.
  const burnsFuel =
    ["gas-furnace", "propane", "oil", "wood"].includes(home.heating ?? "") ||
    ["gas", "both"].includes(home.cooking ?? "") ||
    ["generator", "standby"].includes(home.backupPower ?? "");
  if (burnsFuel && !has("co-detector")) {
    findings.push({
      id: "co-detector",
      area: "Safety",
      kind: "get",
      status: "missing",
      finding: "Fuel-burning appliances or a generator, but no battery carbon monoxide detector recorded.",
      action: "Install battery or battery-backup carbon monoxide detectors near sleeping areas.",
    });
  }
  if (!has("smoke-detector")) {
    findings.push({ id: "smoke-detector", area: "Safety", kind: "get", status: "missing", finding: "No smoke detectors recorded.", action: "Install and test smoke detectors on every floor." });
  }

  // Basic kit.
  const missingKit = Object.entries(BASIC_KIT)
    .filter(([id]) => !has(id as SupplyId))
    .map(([, label]) => label);
  findings.push(
    missingKit.length
      ? {
          id: "basic-kit",
          area: "Kit",
          kind: "get",
          status: missingKit.length > 5 ? "short" : "partial",
          finding: `Missing ${missingKit.length} of ${Object.keys(BASIC_KIT).length} basic kit items: ${missingKit.join(", ")}.`,
          action: `Add ${missingKit.join(", ")}.`,
        }
      : { id: "basic-kit", area: "Kit", kind: "get", status: "ok", finding: "All basic kit items recorded." },
  );

  // The chosen emergency.
  const cold = scenario === "winter-storm" || scenario === "power-outage";
  if (cold && !has("sleeping-bags") && !has("blankets")) {
    findings.push({ id: "warmth", area: "Kit", kind: "get", status: "missing", finding: "No extra blankets or sleeping bags recorded for a cold outage.", action: "Keep cold-rated sleeping bags or extra blankets for everyone." });
  }
  if (["wildfire", "hurricane", "flood"].includes(scenario) && !has("documents")) {
    findings.push({ id: "documents", area: "Plan", kind: "get", status: "missing", finding: "No copies of important documents recorded, and this emergency may mean leaving quickly.", action: "Keep copies of IDs, insurance and medical information in a go-bag or secure cloud storage." });
  }
  if (scenario === "boil-water" && !has("water-filter") && !has("bleach")) {
    findings.push({ id: "water-treatment", area: "Water", kind: "get", status: "missing", finding: "No way to treat water recorded.", action: "Keep unscented bleach or purification tablets, and learn how to use them." });
  }

  return findings.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

/** Findings that need action: everything except "ok". */
export const gaps = (findings: Finding[]) => findings.filter((finding) => finding.status !== "ok");

/** One line for the scenario engine, so injects can test the household's real gaps. */
export function describeGaps(findings: Finding[]): string | undefined {
  const open = gaps(findings).filter((finding) => finding.status !== "unknown");
  if (!open.length) return undefined;
  return `Gaps found by the inventory check (test these in the exercise): ${open.map((finding) => finding.finding.replace(/\.$/, "")).join("; ")}.`;
}

/** Exactly what the scenario engine receives for a household: the profile summary and its gaps. */
export function engineBaseline(profile: HouseholdProfile): string {
  const gapLine = describeGaps(assessInventory(profile));
  return [describeHousehold(profile), gapLine].filter(Boolean).join("\n");
}
