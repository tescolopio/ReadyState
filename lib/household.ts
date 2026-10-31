/**
 * Structured household profile, filled in by the setup wizard and kept in this
 * browser only (decision D9). `describeHousehold` turns it into the attribute
 * summary the scenario engine sees: names, medication names and other
 * `local*` fields never appear in it, and anything the person skipped is
 * reported as unknown rather than assumed (design brief §7).
 */
import type { MaskTerm } from "@/utils/obfuscator";

export const AGE_RANGES = {
  infant: "infant (under 2)",
  child: "child (2–12)",
  teen: "teen (13–17)",
  adult: "adult",
  "older-adult": "older adult (65+)",
} as const;
export type AgeRange = keyof typeof AGE_RANGES;

/**
 * Practical needs, described by what they demand in an emergency rather than
 * by diagnosis. Tags follow docs/architecture/dataset_bridging.md.
 */
export const NEEDS = {
  "refrigerated-medication": {
    label: "Medication that must stay refrigerated",
    hint: "For example insulin or some biologics.",
    tag: "[Refrigerated Medication Dependent]",
    asks: "days",
  },
  "daily-medication": {
    label: "Daily medication they can't skip",
    hint: "For example blood pressure, seizure or heart medication.",
    tag: "[Daily Maintenance Medication]",
    asks: "days",
  },
  "powered-device": {
    label: "Medical device that needs power",
    hint: "For example a CPAP, oxygen concentrator or feeding pump.",
    tag: "[Hardware Power Dependent]",
    asks: "watts",
  },
  "severe-allergy": {
    label: "Severe allergy (carries epinephrine)",
    hint: "Food, insect or other anaphylaxis risk.",
    tag: "[Anaphylaxis Risk] [Epinephrine Dependent]",
  },
  "air-quality": {
    label: "Breathing condition sensitive to smoke or heat",
    hint: "For example asthma or COPD.",
    tag: "[Air Quality Sensitive]",
  },
  stairs: {
    label: "Needs help with stairs or carrying supplies",
    tag: "needs help with stairs and carrying",
  },
  wheelchair: {
    label: "Uses a wheelchair or walker",
    tag: "[Mobility Restricted]",
  },
  hearing: { label: "Deaf or hard of hearing", tag: "[Hearing Impaired]" },
  vision: { label: "Blind or low vision", tag: "[Vision Impaired]" },
  supervision: {
    label: "Needs supervision",
    hint: "For example dementia, or a young child who can't be left alone.",
    tag: "[Needs Supervision]",
  },
  pregnant: { label: "Pregnant", tag: "[Pregnant]" },
} as const satisfies Record<
  string,
  NeedInfo
>;
export type NeedKind = keyof typeof NEEDS;

export interface NeedInfo {
  label: string;
  hint?: string;
  tag: string;
  /** The follow-up question this need asks: days of supply, or device watts. */
  asks?: "days" | "watts";
}
/** `NEEDS` with every entry's optional fields visible to the type checker. */
export const NEED_INFO: Record<NeedKind, NeedInfo> = NEEDS;

export interface Need {
  kind: NeedKind;
  /** Days of supply on hand, for medication needs. */
  daysSupply?: number;
  /** Power draw, for powered devices. */
  watts?: number;
  /** Medication or device name. Stays on this device. */
  localDetail?: string;
}

export interface Person {
  id: string;
  /** Name or nickname, shown only on this device. */
  localName?: string;
  ageRange?: AgeRange;
  needs: Need[];
}

export const PET_KINDS = {
  dog: "dog",
  cat: "cat",
  bird: "bird",
  "small-animal": "small animal",
  reptile: "reptile",
  horse: "horse",
  livestock: "livestock",
  other: "other animal",
} as const;
export type PetKind = keyof typeof PET_KINDS;

export interface Pet {
  id: string;
  localName?: string;
  kind: PetKind;
  size?: "small" | "medium" | "large";
  /** Body weight, for food and water math. */
  weightLb?: number;
  /** Free text such as "on daily seizure medication". Masked before sending. */
  notes?: string;
}

export const HOME_TYPES = {
  apartment: "apartment",
  house: "house",
  townhouse: "townhouse or duplex",
  "mobile-home": "mobile or manufactured home",
  rv: "RV or boat",
  other: "other home",
} as const;
export const HEATING = {
  "gas-furnace": "natural gas furnace",
  electric: "electric heat",
  "heat-pump": "heat pump",
  propane: "propane",
  oil: "heating oil",
  wood: "wood stove or fireplace",
  none: "no heating",
} as const;
export const COOKING = { gas: "gas", electric: "electric", both: "gas and electric" } as const;
export const WATER_SOURCE = { municipal: "municipal water", well: "private well" } as const;
export const BACKUP_POWER = {
  none: "none",
  generator: "portable generator",
  standby: "standby generator",
  battery: "portable power station",
  solar: "solar with battery",
} as const;
export const SETTINGS = { urban: "urban", suburban: "suburban", rural: "rural" } as const;

export interface Home {
  type?: keyof typeof HOME_TYPES;
  floors?: number;
  basement?: boolean;
  heating?: keyof typeof HEATING;
  cooking?: keyof typeof COOKING;
  water?: keyof typeof WATER_SOURCE;
  backupPower?: keyof typeof BACKUP_POWER;
  /** Generator or power station output rating. */
  backupWatts?: number;
  /** Battery capacity of a power station or solar battery, for runtime math. */
  backupWh?: number;
  /** Free text such as "garage is detached, no AC". Masked before sending. */
  notes?: string;
}

/**
 * The backup ratings that apply to the chosen backup power: output for any backup, battery capacity only for a
 * battery or solar battery. A value left over from an earlier choice (the wizard hides its field) is ignored.
 */
export function backupRatings(home: Pick<Home, "backupPower" | "backupWatts" | "backupWh">): { watts?: number; wh?: number } {
  const hasBackup = Boolean(home.backupPower && home.backupPower !== "none");
  const hasBattery = home.backupPower === "battery" || home.backupPower === "solar";
  return { watts: hasBackup ? home.backupWatts : undefined, wh: hasBattery ? home.backupWh : undefined };
}

export interface Location {
  /** State, province or region. Keep it coarse: never an address. */
  region?: string;
  setting?: keyof typeof SETTINGS;
}

/** Common kit items, grouped as on Ready.gov's Build a Kit list. */
export const SUPPLY_ITEMS = {
  Light: {
    flashlights: "Flashlights or headlamps",
    batteries: "Spare batteries",
    lanterns: "Battery lanterns",
  },
  Power: {
    "power-bank": "Phone power banks",
    "car-charger": "Car phone charger",
    "hand-crank": "Hand-crank or solar charger",
    "extension-cord": "Heavy-duty outdoor extension cord (over 20 ft)",
  },
  Communication: {
    "weather-radio": "Battery or hand-crank weather radio",
    "two-way-radios": "Two-way radios",
    "paper-contacts": "Written list of contacts",
    whistle: "Whistle",
  },
  Warmth: {
    "sleeping-bags": "Cold-rated sleeping bags",
    blankets: "Extra blankets",
    "hand-warmers": "Hand warmers",
  },
  Food: {
    "can-opener": "Manual can opener",
    "outdoor-stove": "Camp stove or grill (outdoor use)",
    "fuel": "Spare fuel for stove or generator",
    cooler: "Cooler",
    "ice-packs": "Ice packs or frozen water bottles",
    formula: "Ready-to-feed infant formula",
  },
  Water: {
    "water-filter": "Water filter or purification tablets",
    bleach: "Unscented bleach",
  },
  Sanitation: {
    sanitation: "Moist towelettes, garbage bags and ties",
    "hand-sanitizer": "Hand sanitizer (at least 60% alcohol)",
    "plastic-sheeting": "Plastic sheeting and duct tape",
    "toilet-kit": "Emergency toilet kit (2 buckets, heavy bags, cover material)",
  },
  Safety: {
    "first-aid": "First aid kit",
    "co-detector": "Battery carbon monoxide detector",
    "smoke-detector": "Smoke detectors",
    "fire-extinguisher": "Fire extinguisher",
    "n95": "N95 masks or dust masks",
    "air-cleaner": "Portable air cleaner",
    "utility-tools": "Wrench or pliers to shut off utilities",
  },
  Documents: {
    cash: "Cash in small bills",
    documents: "Copies of important documents",
    "paper-map": "Paper map of the area",
  },
} as const;
export type SupplyId = {
  [Group in keyof typeof SUPPLY_ITEMS]: keyof (typeof SUPPLY_ITEMS)[Group];
}[keyof typeof SUPPLY_ITEMS];

export interface Supplies {
  waterGallons?: number;
  foodDays?: number;
  /** Days of pet food on hand. */
  petFoodDays?: number;
  have: SupplyId[];
  /** Anything else, such as "2 cases of MREs". Masked before sending. */
  other?: string;
}

export const SCENARIOS = {
  surprise: "Surprise me",
  "power-outage": "Extended power outage",
  "winter-storm": "Winter storm",
  "heat-wave": "Heat wave",
  flood: "Flood",
  wildfire: "Wildfire and smoke",
  hurricane: "Hurricane",
  earthquake: "Earthquake",
  tornado: "Tornado",
  "boil-water": "Water contamination (boil-water notice)",
} as const;
export type ScenarioId = keyof typeof SCENARIOS;

export interface HouseholdProfile {
  people: Person[];
  pets: Pet[];
  location: Location;
  home: Home;
  supplies: Supplies;
  scenario: ScenarioId;
}

export const emptyProfile = (): HouseholdProfile => ({
  people: [],
  pets: [],
  location: {},
  home: {},
  supplies: { have: [] },
  scenario: "surprise",
});

export const newId = () => Math.random().toString(36).slice(2, 10);

const SUPPLY_LABELS: Record<string, string> = Object.assign(
  {},
  ...Object.values(SUPPLY_ITEMS),
);

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** "child (2–12)" -> "children (2–12)", "large dog" -> "large dogs". */
const pluralLabel = (label: string) =>
  label.replace(/^(.*?)(\w+)(\s*\(.*\)|\s+of .*)?$/, (_, before: string, noun: string, after = "") => {
    const irregular: Record<string, string> = { child: "children", person: "people", livestock: "livestock" };
    return `${before}${irregular[noun] ?? `${noun}s`}${after}`;
  });

/** "2 adults, 1 child (2–12)". */
const countBy = <T>(items: T[], key: (item: T) => string) => {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts]
    .map(([label, count]) => `${count} ${count === 1 ? label : pluralLabel(label)}`)
    .join(", ");
};

const describeNeed = (need: Need) => {
  const base = NEEDS[need.kind].tag;
  if (need.daysSupply !== undefined) return `${base} (${plural(need.daysSupply, "day")} of supply on hand)`;
  if (need.watts !== undefined) return `${base} (about ${need.watts} W)`;
  return base;
};

const personLabel = (person: Person) =>
  person.ageRange ? AGE_RANGES[person.ageRange] : "person of unknown age";

/**
 * The attribute summary sent to the scenario engine. Free-text notes are
 * included, so callers must still pass the result through `maskInput`.
 */
export function describeHousehold(profile: HouseholdProfile): string {
  const lines: string[] = [];
  const unknown: string[] = [];

  const { people, pets, location, home, supplies } = profile;

  if (people.length) {
    lines.push(`People: ${countBy(people, personLabel)}.`);
    people.forEach((person, index) => {
      if (person.needs.length) {
        lines.push(`- Person ${index + 1} (${personLabel(person)}): ${person.needs.map(describeNeed).join("; ")}.`);
      }
    });
  } else unknown.push("who lives here");

  if (pets.length) {
    const petLabel = (pet: Pet) => [pet.size, PET_KINDS[pet.kind]].filter(Boolean).join(" ");
    lines.push(`Pets: ${countBy(pets, petLabel)}.`);
    for (const pet of pets) {
      const details = [pet.weightLb && `about ${pet.weightLb} lb`, pet.notes?.trim()].filter(Boolean);
      if (details.length) lines.push(`- ${petLabel(pet)}: ${details.join("; ")}`);
    }
  }

  const where = [location.region?.trim(), location.setting && SETTINGS[location.setting]].filter(Boolean);
  if (where.length) lines.push(`Location: ${where.join(", ")}.`);
  else unknown.push("general location");

  const homeParts = [
    home.type && HOME_TYPES[home.type],
    home.floors !== undefined && plural(home.floors, "floor"),
    home.basement === true && "basement",
    home.basement === false && "no basement",
  ].filter(Boolean);
  const ratings = backupRatings(home);
  const backupDetails = [ratings.watts && `about ${ratings.watts} W`, ratings.wh && `${ratings.wh} Wh battery`]
    .filter(Boolean)
    .join(", ");
  const systems = [
    home.heating && `Heating: ${HEATING[home.heating]}.`,
    home.cooking && `Cooking: ${COOKING[home.cooking]}.`,
    home.water && `Water: ${WATER_SOURCE[home.water]}.`,
    home.backupPower &&
      `Backup power: ${BACKUP_POWER[home.backupPower]}${backupDetails ? ` (${backupDetails})` : ""}.`,
  ].filter(Boolean);
  if (homeParts.length || systems.length) {
    lines.push(
      [homeParts.length ? `Home: ${homeParts.join(", ")}.` : "", ...systems].filter(Boolean).join(" "),
    );
  } else unknown.push("home and utilities");
  if (home.notes?.trim()) lines.push(`Home notes: ${home.notes.trim()}`);

  const stock: string[] = [];
  if (supplies.waterGallons !== undefined) {
    // Ready.gov: one gallon per person per day.
    const days = people.length ? supplies.waterGallons / people.length : undefined;
    stock.push(
      `${plural(supplies.waterGallons, "gallon")} of stored water` +
        (days !== undefined ? ` (about ${days.toFixed(1)} days at 1 gallon per person per day, before pets)` : ""),
    );
  }
  if (supplies.foodDays !== undefined) stock.push(`${plural(supplies.foodDays, "day")} of food`);
  if (supplies.petFoodDays !== undefined) stock.push(`${plural(supplies.petFoodDays, "day")} of pet food`);
  if (stock.length) lines.push(`Stored: ${stock.join(", ")}.`);
  if (supplies.have.length) {
    lines.push(`Has: ${supplies.have.map((id) => SUPPLY_LABELS[id]?.toLowerCase() ?? id).join(", ")}.`);
  }
  if (supplies.other?.trim()) lines.push(`Other supplies: ${supplies.other.trim()}`);
  if (!stock.length && !supplies.have.length && !supplies.other?.trim()) unknown.push("supplies");

  if (unknown.length) {
    lines.push(`Not provided: ${unknown.join(", ")}. Treat these as unknown; don't assume them.`);
  }
  lines.push(
    profile.scenario === "surprise"
      ? "Emergency to practice: choose one that fits the location and season."
      : `Emergency to practice: ${SCENARIOS[profile.scenario].toLowerCase()}.`,
  );

  return lines.join("\n");
}

/** True once the profile has anything worth starting an exercise from. */
export const hasProfile = (profile: HouseholdProfile) =>
  profile.people.length > 0 || profile.pets.length > 0 || Boolean(profile.location.region);

/**
 * Everything in the profile that must never be sent: names (whole, and each
 * word, so "Priya's" is caught in notes), plus medication and device names,
 * tagged as medical details rather than people. Passed to `maskInput` as
 * `alwaysMask` so free-text notes can't leak them.
 */
export function privateTerms(profile: HouseholdProfile): Exclude<MaskTerm, string>[] {
  const named = (entries: { localName?: string }[], kind: "Person" | "Pet") =>
    entries.flatMap(({ localName }) => {
      const name = localName?.trim();
      if (!name) return [];
      // Each word only in its own capitalization, so a name like "Ash" or "Will" doesn't hide "ash" or "will".
      const words = name.split(/\s+/).filter((word) => word.length > 1 && word !== name);
      return [{ value: name, kind }, ...words.map((word) => ({ value: word, kind, caseSensitive: true }))];
    });
  // The whole detail and each item of a list, so "metformin" is caught on its own from "Lisinopril and metformin".
  const details = profile.people
    .flatMap((person) => person.needs.map((need) => need.localDetail?.trim() ?? ""))
    .flatMap((detail) => [detail, ...detail.split(/\s*(?:,|;|\/|&|\+|\band\b|\bplus\b)\s*/i)])
    .map((detail) => detail.trim())
    .filter((detail) => detail.length > 2)
    .map((value) => ({ value, kind: "Medical" as const }));
  const seen = new Set<string>();
  return [...named(profile.people, "Person"), ...named(profile.pets, "Pet"), ...details].filter((term) => {
    const key = `${term.value.toLowerCase()}|${"caseSensitive" in term}`;
    return !seen.has(key) && Boolean(seen.add(key));
  });
}

/** The private terms that appear in `text`, each matched as `maskInput` matches it. */
export function leakedTerms(text: string, terms: Exclude<MaskTerm, string>[]): string[] {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return terms
    .filter(({ value, caseSensitive }) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(value)}(?![\\p{L}\\p{N}])`, caseSensitive ? "u" : "iu").test(text))
    .map(({ value }) => value);
}
