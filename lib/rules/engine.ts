/**
 * Runs the rules database against a household profile. Rules see the profile
 * only through the named facts below, so content authors work with a stable
 * vocabulary instead of the profile's shape. Add a fact here when a rule needs
 * one; lib/rules/rules.test.ts rejects rules that use unknown facts.
 */
import {
  AGE_RANGES,
  NEED_INFO,
  backupRatings,
  type HouseholdProfile,
  type Need,
  type Person,
} from "@/lib/household";
import guidanceJson from "@/data/rules/guidance.json";
import type { Condition, InventoryRule } from "@/lib/rules/schema";

export type FactValue = string | number | boolean | string[] | undefined;
export type Facts = Record<string, FactValue>;

/** Facts every rule can use, with a description for the rules documentation. */
export const PROFILE_FACTS: Record<string, string> = {
  "people.count": "Number of people recorded",
  headcount: "Number of people, at least 1 (for per-person supplies)",
  "pets.count": "Number of pets",
  "pets.any": "True when there are pets",
  "home.type": "Home type id (apartment, house, …)",
  "home.floors": "Number of floors",
  "home.heating": "Heating id (gas-furnace, electric, …)",
  "home.cooking": "Cooking id (gas, electric, both)",
  "home.water": "Water source id (municipal, well)",
  "home.backupPower": "Backup power id (none, generator, …)",
  "home.burnsFuel": "True when heating, cooking or backup power burns fuel",
  hasBackupPower: "True when backup power other than none is recorded",
  scenario: "The chosen emergency id",
  "supplies.have": "Ids of the supply items checked",
  "water.daysPerPerson": "Stored gallons divided by headcount",
  "water.gallonsPerDay": "Daily water need: 1 gallon per person plus pets' drinking water",
  "water.days": "Stored gallons divided by the daily need, pets included",
  "pets.waterGallonsPerDay": 'Pets\' daily drinking water in gallons, formatted ("2.1"), when their weights are known',
  "pets.kcalPerDay": 'Pets\' daily calories, formatted ("5,040"), when their weights are known',
  "pets.weightsMissing": "True when a dog or cat has no weight recorded",
  "household.kcalPerDay": 'People\'s estimated daily calories, formatted ("4,400"); infants excluded',
  "household.kcal3Days": "People's calories for 3 days, formatted",
  "household.kcal14Days": "People's calories for 2 weeks, formatted",
  "food.days": "Days of food",
  "petFood.days": "Days of pet food",
  "water.daysHotWeather": 'Stored water in days at 2 gallons per person per day, formatted ("1.5 days")',
  "needs.kinds": "Every need id recorded for anyone in the household",
  "people.ageRanges": "Every age range id in the household",
};

/** Extra facts for rules that run once per recorded need (`forEach: "need"`). */
export const NEED_FACTS: Record<string, string> = {
  "person.id": "The person's profile id",
  "person.label": 'How the person is described, e.g. "Person 3 (older adult (65+))"',
  "need.kind": "Need id (refrigerated-medication, powered-device, …)",
  "need.label": "The need's label, lowercased",
  "need.asksDays": "True for needs measured in days of supply",
  "need.daysSupply": "Days of supply on hand",
  "need.watts": "Device power draw in watts",
  "need.kwhPerDay": "Device energy per day in kWh, from its watts",
  "need.backupHours": "Hours the recorded battery (Wh) runs the device, at 85% inverter efficiency",
};

const fuelHeating = ["gas-furnace", "propane", "oil", "wood"];

/** A number from data/rules/guidance.json, so the math uses the same sourced values as the rules. */
const guidanceValue = (id: string, key: string): number => {
  const records = guidanceJson as unknown as Array<{ id: string; values: Record<string, number> }>;
  const value = records.find((r) => r.id === id)?.values[key];
  if (value === undefined) throw new Error(`guidance ${id} has no value ${key}`);
  return value;
};

const thousands = (value: number) => Math.round(value).toLocaleString("en-US");
const KG_PER_LB = 0.45359237;

/** Maintenance calories for a dog or cat (Pet Nutrition Alliance): 70 × kg^0.75 × a neutered-adult factor. */
export const petKcalPerDay = (kind: string, weightLb: number) => {
  const rer = guidanceValue("calories.pets", "rerFactor") * (weightLb * KG_PER_LB) ** guidanceValue("calories.pets", "rerExponent");
  return rer * guidanceValue("calories.pets", kind === "cat" ? "catNeutered" : "dogNeutered");
};

/** Calories and water are estimated for dogs and cats only; other animals vary too widely. */
const COUNTED_PETS = ["dog", "cat"];

export function profileFacts(profile: HouseholdProfile): Facts {
  const { people, pets, home, supplies } = profile;
  const headcount = Math.max(1, people.length);

  const counted = pets.filter((pet) => COUNTED_PETS.includes(pet.kind));
  const weighed = counted.filter((pet) => pet.weightLb);
  const petKcal = weighed.reduce((sum, pet) => sum + petKcalPerDay(pet.kind, pet.weightLb!), 0);
  // Dogs: about 1 ounce of water per pound a day. Cats are counted the same way here.
  const petWater = weighed.reduce((sum, pet) => sum + (pet.weightLb! * guidanceValue("water.pets", "ouncesPerPoundPerDay")) / 128, 0);
  const waterPerDay = headcount * guidanceValue("water.supply", "gallonsPerPersonPerDay") + petWater;

  const kcalByAge = (age?: string) => (age && age !== "infant" ? guidanceValue("calories.people", age) : age === "infant" ? 0 : guidanceValue("calories.people", "adult"));
  const peopleKcal = people.reduce((sum, person) => sum + kcalByAge(person.ageRange), 0);

  return {
    "people.count": people.length,
    headcount,
    "pets.count": pets.length,
    "pets.any": pets.length > 0 || undefined,
    "home.type": home.type,
    "home.floors": home.floors,
    "home.heating": home.heating,
    "home.cooking": home.cooking,
    "home.water": home.water,
    "home.backupPower": home.backupPower,
    "home.burnsFuel":
      fuelHeating.includes(home.heating ?? "") ||
      ["gas", "both"].includes(home.cooking ?? "") ||
      ["generator", "standby"].includes(home.backupPower ?? ""),
    hasBackupPower: Boolean(home.backupPower && home.backupPower !== "none"),
    scenario: profile.scenario,
    "supplies.have": supplies.have,
    "water.daysPerPerson": supplies.waterGallons === undefined ? undefined : supplies.waterGallons / headcount,
    "water.gallonsPerDay": Math.round(waterPerDay * 10) / 10,
    "water.days": supplies.waterGallons === undefined ? undefined : supplies.waterGallons / waterPerDay,
    "pets.waterGallonsPerDay": weighed.length ? (Math.round(petWater * 10) / 10).toFixed(1) : undefined,
    "pets.kcalPerDay": weighed.length ? thousands(petKcal) : undefined,
    "pets.weightsMissing": counted.length > weighed.length || undefined,
    "household.kcalPerDay": peopleKcal ? thousands(peopleKcal) : undefined,
    "household.kcal3Days": peopleKcal ? thousands(peopleKcal * 3) : undefined,
    "household.kcal14Days": peopleKcal ? thousands(peopleKcal * 14) : undefined,
    "food.days": supplies.foodDays,
    "petFood.days": supplies.petFoodDays,
    "water.daysHotWeather":
      supplies.waterGallons === undefined ? undefined : days(Math.round((supplies.waterGallons / headcount / 2) * 10) / 10),
    "needs.kinds": [...new Set(people.flatMap((person) => person.needs.map((need) => need.kind)))],
    "people.ageRanges": [...new Set(people.flatMap((person) => (person.ageRange ? [person.ageRange] : [])))],
  };
}

export function needFacts(person: Person, index: number, need: Need): Facts {
  const info = NEED_INFO[need.kind];
  return {
    "person.id": person.id,
    "person.label": `Person ${index + 1}${person.ageRange ? ` (${AGE_RANGES[person.ageRange]})` : ""}`,
    "need.kind": need.kind,
    "need.label": info.label.toLowerCase(),
    "need.asksDays": info.asks === "days",
    "need.daysSupply": need.daysSupply,
    "need.watts": need.watts,
    "need.kwhPerDay": need.watts ? ((need.watts * 24) / 1000).toFixed(1) : undefined,
  };
}

/** Per-need facts that also depend on the home, such as battery runtime for a device. */
export function needHomeFacts(profile: HouseholdProfile, need: Need): Facts {
  const backupWh = backupRatings(profile.home).wh;
  if (!need.watts || !backupWh) return {};
  // Inverters lose some energy; 85% is a common planning figure.
  return { "need.backupHours": Math.round(((backupWh * 0.85) / need.watts) * 10) / 10 };
}

export function evaluate(condition: Condition, facts: Facts): boolean {
  if ("all" in condition) return condition.all.every((c) => evaluate(c, facts));
  if ("any" in condition) return condition.any.some((c) => evaluate(c, facts));
  if ("not" in condition) return !evaluate(condition.not, facts);
  const value = facts[condition.fact];
  const list = Array.isArray(value) ? value : [];
  if ("equals" in condition) return value === condition.equals;
  if ("in" in condition) return condition.in.includes(value as string | number);
  if ("includes" in condition) return list.includes(condition.includes);
  if ("includesAll" in condition) return condition.includesAll.every((item) => list.includes(item));
  if ("includesAny" in condition) return condition.includesAny.some((item) => list.includes(item));
  if ("gt" in condition) return typeof value === "number" && value > condition.gt;
  if ("lt" in condition) return typeof value === "number" && value < condition.lt;
  return (value !== undefined && value !== false) === condition.exists;
}

/** Every fact name a condition refers to, for validation. */
export function conditionFacts(condition: Condition): string[] {
  if ("all" in condition) return condition.all.flatMap(conditionFacts);
  if ("any" in condition) return condition.any.flatMap(conditionFacts);
  if ("not" in condition) return conditionFacts(condition.not);
  return [condition.fact];
}

const days = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)} day${value === 1 ? "" : "s"}`;

/**
 * Fills `{fact}` placeholders, and `{fact? text}` sections that appear only
 * when the fact is set: "per day{pets.any?, plus extra for pets}".
 */
export function render(template: string, facts: Facts): string {
  return template
    .replace(/\{([\w.]+)\?([^{}]*(?:\{[\w.]+\}[^{}]*)*)\}/g, (_, name: string, inner: string) =>
      facts[name] !== undefined && facts[name] !== false ? inner : "",
    )
    .replace(/\{([\w.]+)\}/g, (match, name: string) => {
      const value = facts[name];
      if (value === undefined) return match;
      return Array.isArray(value) ? value.join(", ") : String(value);
    });
}

/** Placeholder names a template uses, for validation. */
export const templateFacts = (template: string) =>
  [...template.matchAll(/\{([\w.]+)\??/g)].map((match) => match[1]);

export type FindingStatus = "missing" | "short" | "partial" | "unknown" | "ok";

export interface Finding {
  id: string;
  area: InventoryRule["area"];
  status: FindingStatus;
  finding: string;
  action?: string;
  kind: InventoryRule["kind"];
  /** The rule that produced it, for tracing back to its sources. */
  rule: string;
}

function applyRule(rule: InventoryRule, facts: Facts): Finding | undefined {
  if (rule.when && !evaluate(rule.when, facts)) return undefined;
  const base = { id: render(rule.findingId ?? rule.id, facts), area: rule.area, kind: rule.kind, rule: rule.id };

  if (rule.type === "supply") {
    const value = facts[rule.metric];
    if (typeof value !== "number") {
      return { ...base, status: "unknown", finding: render(rule.messages.unknown, facts), action: render(rule.actions.unknown, facts) };
    }
    const graded = (status: FindingStatus, target: number) => {
      const shortBy = Math.ceil(target - value);
      const local = {
        ...facts,
        days: days(value),
        shortBy: days(shortBy),
        shortByGallons: Math.ceil((target - value) * Number(facts["water.gallonsPerDay"] ?? facts.headcount ?? 1)),
      };
      const message = status === "short" ? rule.messages.short : rule.messages.partial!;
      const action = status === "short" ? rule.actions.short : rule.actions.partial!;
      return { ...base, status, finding: render(message, local), action: render(action, local) };
    };
    if (value < rule.minimum) return graded("short", rule.minimum);
    if (rule.goal !== undefined && value < rule.goal) return graded("partial", rule.goal);
    return { ...base, status: "ok", finding: render(rule.messages.ok, { ...facts, days: days(value) }) };
  }

  if (rule.type === "kit") {
    const have = (facts["supplies.have"] as string[] | undefined) ?? [];
    const missing = Object.entries(rule.items).filter(([id]) => !have.includes(id)).map(([, label]) => label);
    if (!missing.length) return { ...base, status: "ok", finding: render(rule.okFinding, facts) };
    const local = { ...facts, missingCount: missing.length, total: Object.keys(rule.items).length, missingList: missing.join(", ") };
    return {
      ...base,
      status: missing.length > rule.shortAbove ? "short" : "partial",
      finding: render(rule.finding, local),
      action: render(rule.action, local),
    };
  }

  const passed = rule.pass ? evaluate(rule.pass, facts) : false;
  if (passed) return rule.reportOk ? { ...base, status: "ok", finding: render(rule.finding, facts) } : undefined;
  return { ...base, status: rule.failStatus, finding: render(rule.finding, facts), action: render(rule.action, facts) };
}

const STATUS_ORDER: Record<FindingStatus, number> = { missing: 0, short: 1, partial: 2, unknown: 3, ok: 4 };

/** Runs inventory rules over a profile, worst findings first. */
export function runInventoryRules(rules: InventoryRule[], profile: HouseholdProfile): Finding[] {
  const facts = profileFacts(profile);
  const findings: Finding[] = [];
  for (const rule of rules) {
    if (rule.forEach === "need") {
      profile.people.forEach((person, index) => {
        for (const need of person.needs) {
          const finding = applyRule(rule, { ...facts, ...needFacts(person, index, need), ...needHomeFacts(profile, need) });
          if (finding) findings.push(finding);
        }
      });
    } else {
      const finding = applyRule(rule, facts);
      if (finding) findings.push(finding);
    }
  }
  return findings.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}
