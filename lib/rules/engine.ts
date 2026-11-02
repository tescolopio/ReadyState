/**
 * Runs the rules database against a household profile. Rules see the profile
 * only through the named facts below, so content authors work with a stable
 * vocabulary instead of the profile's shape. Add a fact here when a rule needs
 * one; lib/rules/rules.test.ts rejects rules that use unknown facts.
 */
import {
  AGE_RANGES,
  NEED_INFO,
  SUPPLY_LABELS,
  UNASSESSED_ANSWERS,
  backupRatings,
  type HouseholdProfile,
  type Need,
  type Person,
  type SupplyId,
  type UnassessedAnswer,
} from "@/lib/household";
import guidanceJson from "@/data/rules/guidance.json";
import type { Condition, InventoryRule } from "@/lib/rules/schema";
import { waterDisplay } from "@/lib/water-display";

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
  "home.backupWh": "Recorded applicable battery capacity in watt-hours",
  "home.burnsFuel": "True when heating, cooking or backup power burns fuel",
  hasBackupPower: "True when backup power other than none is recorded",
  scenario: "The chosen emergency id",
  "supplies.have": "Ids of the supply items checked",
  "supplies.absent": "Supply items explicitly reported absent",
  "water.gallons": "Stored water recorded, in gallons",
  "water.daysPerPerson": "Stored gallons divided by headcount",
  "water.gallonsPerDay": "Estimated daily gallons for recorded people and weighed dogs/cats",
  "water.days": "Stored gallons divided by that estimated daily need",
  "pets.waterGallonsPerDay": 'Drinking-water estimate for weighed dogs/cats in gallons, formatted ("2.1")',
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
export const guidanceValue = (id: string, key: string): number => {
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
    "home.backupWh": backupRatings(home).wh,
    "home.burnsFuel": (
      fuelHeating.includes(home.heating ?? "") ||
      ["gas", "both"].includes(home.cooking ?? "") ||
      ["generator", "standby"].includes(home.backupPower ?? "")) ? true :
        home.heating !== undefined && home.cooking !== undefined && home.backupPower !== undefined ? false : undefined,
    hasBackupPower: home.backupPower === undefined ? undefined : home.backupPower !== "none",
    scenario: profile.scenario,
    "supplies.have": supplies.have,
    "supplies.absent": supplies.absent ?? [],
    "water.gallons": supplies.waterGallons,
    "water.daysPerPerson": supplies.waterGallons === undefined || !people.length ? undefined : supplies.waterGallons / headcount,
    "water.gallonsPerDay": people.length ? Math.round(waterPerDay * 10) / 10 : undefined,
    "water.days": supplies.waterGallons === undefined || !people.length ? undefined : supplies.waterGallons / waterPerDay,
    "pets.waterGallonsPerDay": weighed.length ? (Math.round(petWater * 10) / 10).toFixed(1) : undefined,
    "pets.kcalPerDay": weighed.length ? thousands(petKcal) : undefined,
    "pets.weightsMissing": counted.length > weighed.length,
    "household.kcalPerDay": peopleKcal ? thousands(peopleKcal) : undefined,
    "household.kcal3Days": peopleKcal ? thousands(peopleKcal * 3) : undefined,
    "household.kcal14Days": peopleKcal ? thousands(peopleKcal * 14) : undefined,
    "food.days": supplies.foodDays,
    "petFood.days": supplies.petFoodDays,
    "water.daysHotWeather":
      supplies.waterGallons === undefined || !people.length ? undefined : days(Math.round((supplies.waterGallons / headcount / 2) * 10) / 10),
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
  if (!need.watts || backupWh === undefined) return {};
  // Inverters lose some energy; 85% is a common planning figure.
  return { "need.backupHours": Math.round(((backupWh * 0.85) / need.watts) * 10) / 10 };
}

function truth(condition: Condition, facts: Facts): boolean | undefined {
  if ("all" in condition || "any" in condition) {
    const all = "all" in condition;
    const values = (all ? condition.all : condition.any).map(c => truth(c, facts));
    if (values.includes(!all)) return !all;
    return values.includes(undefined) ? undefined : all;
  }
  if ("not" in condition) {
    const value = truth(condition.not, facts);
    return value === undefined ? undefined : !value;
  }
  const value = facts[condition.fact];
  if ("exists" in condition) return (value !== undefined && value !== false) === condition.exists;
  if (value === undefined) return undefined;
  const list = Array.isArray(value) ? value : [];
  if (condition.fact === "supplies.have") {
    const absent = facts["supplies.absent"];
    const item = (id: string) => list.includes(id) ? true : Array.isArray(absent) && absent.includes(id) ? false : undefined;
    if ("includes" in condition) return item(condition.includes);
    const values = ("includesAll" in condition ? condition.includesAll : "includesAny" in condition ? condition.includesAny : []).map(item);
    if ("includesAll" in condition) return values.includes(false) ? false : values.includes(undefined) ? undefined : true;
    if ("includesAny" in condition) return values.includes(true) ? true : values.includes(undefined) ? undefined : false;
  }
  if ("equals" in condition) return value === condition.equals;
  if ("in" in condition) return condition.in.includes(value as string | number);
  if ("includes" in condition) return list.includes(condition.includes);
  if ("includesAll" in condition) return condition.includesAll.every((item) => list.includes(item));
  if ("includesAny" in condition) return condition.includesAny.some((item) => list.includes(item));
  if ("gt" in condition) return typeof value === "number" && value > condition.gt;
  if ("lt" in condition) return typeof value === "number" && value < condition.lt;
  return undefined;
}

export function evaluate(condition: Condition, facts: Facts): boolean {
  return truth(condition, facts) === true;
}

/** Every fact name a condition refers to, for validation. */
export function conditionFacts(condition: Condition): string[] {
  if ("all" in condition) return condition.all.flatMap(conditionFacts);
  if ("any" in condition) return condition.any.flatMap(conditionFacts);
  if ("not" in condition) return conditionFacts(condition.not);
  return [condition.fact];
}

function checksMissingAnswer(condition: Condition): boolean {
  if ("all" in condition) return condition.all.some(checksMissingAnswer);
  if ("any" in condition) return condition.any.some(checksMissingAnswer);
  if ("not" in condition) return false;
  return ("exists" in condition && !condition.exists) ||
    (condition.fact === "pets.weightsMissing" && "equals" in condition && condition.equals === true);
}

function conditionItems(condition: Condition): string[] {
  if ("all" in condition) return condition.all.flatMap(conditionItems);
  if ("any" in condition) return condition.any.flatMap(conditionItems);
  if ("not" in condition) return conditionItems(condition.not);
  if (condition.fact !== "supplies.have") return [];
  return "includes" in condition ? [condition.includes] :
    "includesAll" in condition ? condition.includesAll : "includesAny" in condition ? condition.includesAny : [];
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
  category: "gap" | "unassessed" | "planning" | "scenario" | "recorded";
  evidence: { fact: string; label: string; value: FactValue }[];
}

function applyRule(rule: InventoryRule, facts: Facts, answers: Record<string, UnassessedAnswer> = {}): Finding | undefined {
  const applicability = rule.when ? truth(rule.when, facts) : true;
  if (applicability === false) return undefined;
  const used = [...new Set([
    ...(rule.when ? conditionFacts(rule.when) : []),
    ...(rule.type === "supply" ? [rule.metric, ...templateFacts(JSON.stringify(rule.messages)), ...templateFacts(JSON.stringify(rule.actions))] :
      rule.type === "kit" ? ["supplies.have", "supplies.absent"] :
        [...(rule.pass ? conditionFacts(rule.pass) : []), ...templateFacts(rule.finding), ...templateFacts(rule.action)]),
  ])];
  if (rule.type === "supply" && rule.metric === "water.days") {
    used.push("water.gallons", "people.count", "water.gallonsPerDay", "pets.waterGallonsPerDay", "pets.weightsMissing");
  }
  if (used.includes("need.backupHours")) used.push("need.watts", "home.backupWh");
  if (used.includes("need.kwhPerDay")) used.push("need.watts");
  if (used.includes("pets.any")) used.push("pets.count");
  if (used.includes("hasBackupPower")) used.push("home.backupPower");
  if (used.includes("home.burnsFuel")) used.push("home.heating", "home.cooking", "home.backupPower");
  const answerKey = (fact: string) => {
    if (fact.startsWith("need.")) return `need.${facts["person.id"]}.${facts["need.kind"]}.${fact.slice(5)}`;
    return ({ "food.days": "supplies.foodDays", "petFood.days": "supplies.petFoodDays", "water.gallons": "supplies.waterGallons" } as Record<string, string>)[fact] ?? fact;
  };
  const evidence = [...new Set(used)].filter(fact => (fact in PROFILE_FACTS || fact in NEED_FACTS) &&
    fact !== "supplies.have" && fact !== "supplies.absent" && !(fact === "scenario" && facts.scenario === "not-selected")).map(fact => ({
    fact, label: PROFILE_FACTS[fact] ?? NEED_FACTS[fact],
    value: facts[fact] ?? (answers[answerKey(fact)] ? UNASSESSED_ANSWERS[answers[answerKey(fact)]] : undefined),
  }));
  const items = [...new Set(rule.type === "kit" ? Object.keys(rule.items) : [
    ...(rule.when ? conditionItems(rule.when) : []),
    ...(rule.type === "check" && rule.pass ? conditionItems(rule.pass) : []),
  ])];
  for (const id of items) {
    const present = facts["supplies.have"];
    const absent = facts["supplies.absent"];
    evidence.push({
      fact: `supplies.${id}`, label: SUPPLY_LABELS[id],
      value: Array.isArray(present) && present.includes(id) ? "Present" :
        Array.isArray(absent) && absent.includes(id) ? "Explicitly absent" :
          answers[`supplies.${id}`] ? UNASSESSED_ANSWERS[answers[`supplies.${id}`]] : "Not answered",
    });
  }
  const base = { id: render(rule.findingId ?? rule.id, facts), area: rule.area, kind: rule.kind, rule: rule.id, evidence };
  const unassessed = (): Finding => ({
    ...base, status: "unknown", category: "unassessed",
    finding: rule.id === "well-pump"
      ? facts["home.water"] === undefined
        ? "Well-pump continuity: water source is unanswered. Stored water quantity is assessed separately."
        : "Well-pump continuity: backup power is unanswered. Stored water quantity is assessed separately."
      : rule.id === "water"
        ? `Stored-water duration: ${typeof facts["water.gallons"] !== "number" ? "stored quantity is unanswered" : "household person count is unanswered"}.`
        : `${rule.area}: this check is unassessed because an answer it needs has not been provided.`,
  });
  if (applicability === undefined) return unassessed();

  if (rule.type === "supply") {
    const value = facts[rule.metric];
    if (typeof value !== "number") {
      return unassessed();
    }
    const graded = (status: FindingStatus, target: number) => {
      const shortBy = Math.ceil(target - value);
      const local = {
        ...facts,
        days: rule.metric === "water.days" ? `${waterDisplay(value, 1)} days` : days(value),
        shortBy: days(shortBy),
        shortByGallons: Math.ceil((target - value) * Number(facts["water.gallonsPerDay"] ?? facts.headcount ?? 1)),
      };
      const message = status === "short" ? rule.messages.short : rule.messages.partial!;
      const action = status === "short" ? rule.actions.short : rule.actions.partial!;
      return { ...base, category: "gap" as const, status, finding: render(message, local), action: render(action, local) };
    };
    if (value < rule.minimum) return graded("short", rule.minimum);
    if (rule.goal !== undefined && value < rule.goal) return graded("partial", rule.goal);
    return { ...base, category: "recorded", status: "ok", finding: render(rule.messages.ok, { ...facts, days: days(value) }) };
  }

  if (rule.type === "kit") {
    const have = (facts["supplies.have"] as string[] | undefined) ?? [];
    const absent = (facts["supplies.absent"] as string[] | undefined) ?? [];
    const missing = Object.entries(rule.items).filter(([id]) => absent.includes(id) && !have.includes(id)).map(([, label]) => label);
    if (!missing.length) return Object.keys(rule.items).every(id => have.includes(id))
      ? { ...base, category: "recorded", status: "ok", finding: render(rule.okFinding, facts) } : unassessed();
    const local = { ...facts, missingCount: missing.length, total: Object.keys(rule.items).length, missingList: missing.join(", ") };
    return {
      ...base,
      category: "gap",
      status: missing.length > rule.shortAbove ? "short" : "partial",
      finding: render(rule.finding, local),
      action: render(rule.action, local),
    };
  }

  const passed = rule.pass ? truth(rule.pass, facts) : false;
  if (passed === undefined) return unassessed();
  if (passed) return rule.reportOk ? { ...base, category: "recorded", status: "ok", finding: "Recorded answers meet this check." } : undefined;
  const missingInput = rule.when && checksMissingAnswer(rule.when);
  if (missingInput) return unassessed();
  const category = used.includes("scenario") && facts.scenario !== "not-selected" ? "scenario" :
    rule.failStatus === "unknown" ? "planning" : "gap";
  return { ...base, category, status: rule.failStatus, finding: render(rule.finding, facts), action: render(rule.action, facts) };
}

const STATUS_ORDER: Record<FindingStatus, number> = { missing: 0, short: 1, partial: 2, unknown: 3, ok: 4 };

/** Runs inventory rules over a profile, worst findings first. */
export function runInventoryRules(rules: InventoryRule[], profile: HouseholdProfile, options: { scenario?: boolean } = {}): Finding[] {
  const facts = profileFacts(profile);
  if (options.scenario === false) facts.scenario = "not-selected";
  const findings: Finding[] = [];
  for (const rule of rules) {
    if (rule.id === "infant-formula" && profile.answers?.["supplies.formula"] === "not-applicable") continue;
    if (rule.forEach === "need") {
      profile.people.forEach((person, index) => {
        for (const need of person.needs) {
          const finding = applyRule(rule, { ...facts, ...needFacts(person, index, need), ...needHomeFacts(profile, need) }, profile.answers);
          if (finding) findings.push(finding);
        }
      });
    } else {
      const finding = applyRule(rule, facts, profile.answers);
      if (finding) findings.push(finding);
    }
  }
  const unassessedItems = Object.keys(SUPPLY_LABELS).filter(id =>
    !profile.supplies.have.includes(id as SupplyId) && !(profile.supplies.absent ?? []).includes(id as SupplyId) &&
    profile.answers?.[`supplies.${id}`] !== "not-applicable");
  if (unassessedItems.length) findings.push({
    id: "unassessed-items", rule: "basic-kit", area: "Kit", kind: "plan", category: "unassessed", status: "unknown",
    finding: `${unassessedItems.length} supply items are unassessed, not confirmed absent.`,
    evidence: unassessedItems.map(id => ({
      fact: `supplies.${id}`, label: SUPPLY_LABELS[id],
      value: profile.answers?.[`supplies.${id}`] ? UNASSESSED_ANSWERS[profile.answers[`supplies.${id}`]] : "Not answered",
    })),
  });
  return findings.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}
