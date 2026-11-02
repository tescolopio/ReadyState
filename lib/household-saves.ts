import { z } from "zod";
import { replaceStorageEntries } from "@/lib/browser-storage";

import {
  AGE_RANGES, BACKUP_POWER, COOKING, HEATING, HOME_TYPES, NEEDS, PET_KINDS,
  SCENARIOS, SETTINGS, SUPPLY_LABELS, UNASSESSED_ANSWERS, WATER_SOURCE,
  type HouseholdProfile, type SupplyId,
} from "@/lib/household";
import { PLAN_STATUSES, type PlanItem } from "@/store/usePlanStore";

export const SAVES_KEY = "readystate-household-saves";
export const MAX_SAVE_BYTES = 2 * 1024 * 1024;
const text = z.string().max(20_000);
const id = z.string().min(1).max(100);
const number = z.number().finite().nonnegative();
const keyOf = <T extends object>(values: T) =>
  z.custom<Extract<keyof T, string>>(value => typeof value === "string" && Object.hasOwn(values, value), "Unknown answer choice");
const needKind = keyOf(NEEDS);
const unique = <T>(values: T[]) => new Set(values).size === values.length;
const supplyId = z.custom<SupplyId>(value => typeof value === "string" && Object.hasOwn(SUPPLY_LABELS, value), "Unknown supply item");

const profileSchema: z.ZodType<HouseholdProfile> = z.strictObject({
  people: z.array(z.strictObject({
    id, localName: text.optional(), ageRange: keyOf(AGE_RANGES).optional(),
    needs: z.array(z.strictObject({
      kind: needKind, daysSupply: number.optional(), watts: number.optional(), localDetail: text.optional(),
    })).refine(needs => unique(needs.map(need => need.kind)), "Duplicate needs"),
    absentNeeds: z.array(needKind).optional(),
  })).max(500),
  pets: z.array(z.strictObject({
    id, localName: text.optional(), kind: keyOf(PET_KINDS),
    size: z.enum(["small", "medium", "large"]).optional(), weightLb: number.optional(), notes: text.optional(),
  })).max(500),
  location: z.strictObject({ region: text.optional(), setting: keyOf(SETTINGS).optional() }),
  home: z.strictObject({
    type: keyOf(HOME_TYPES).optional(), floors: number.optional(), basement: z.boolean().optional(),
    heating: keyOf(HEATING).optional(), cooking: keyOf(COOKING).optional(),
    water: keyOf(WATER_SOURCE).optional(), backupPower: keyOf(BACKUP_POWER).optional(),
    backupWatts: number.optional(), backupWh: number.optional(), notes: text.optional(),
  }),
  supplies: z.strictObject({
    waterGallons: number.optional(), foodDays: number.optional(), petFoodDays: number.optional(),
    have: z.array(supplyId), absent: z.array(supplyId).optional(), other: text.optional(),
  }),
  scenario: keyOf(SCENARIOS),
  answers: z.record(z.string().max(300), keyOf(UNASSESSED_ANSWERS)).optional(),
}).superRefine((profile, context) => {
  const invalid = (message: string) => context.addIssue({ code: "custom", message });
  if (!unique([...profile.people, ...profile.pets].map(entry => entry.id))) invalid("Duplicate household identifiers");
  if (!unique(profile.supplies.have) || !unique(profile.supplies.absent ?? [])) invalid("Duplicate supply answers");
  if (profile.supplies.have.some(item => profile.supplies.absent?.includes(item))) invalid("Conflicting supply answers");
  for (const person of profile.people) {
    if (!unique(person.absentNeeds ?? []) || person.needs.some(need => person.absentNeeds?.includes(need.kind))) {
      invalid("Conflicting need answers");
    }
  }
  for (const [key, state] of Object.entries(profile.answers ?? {})) {
    if (state === "not-applicable" && key !== "supplies.formula") invalid("Unsupported not-applicable answer");
    if (key.startsWith("supplies.")) {
      const field = key.slice(9);
      if (Object.hasOwn(SUPPLY_LABELS, field)) {
        if ([...profile.supplies.have, ...(profile.supplies.absent ?? [])].some(item => item === field)) invalid("Conflicting supply answer state");
      } else if (["waterGallons", "foodDays", "petFoodDays"].includes(field)) {
        if (Object.entries(profile.supplies).some(([name, value]) => name === field && value !== undefined)) invalid("Conflicting quantity answer state");
      } else invalid("Unknown supply answer state");
    } else if (key.startsWith("home.") || key.startsWith("location.")) {
      const [group, field] = key.split(".");
      const record = group === "home" ? profile.home : profile.location;
      const allowed = group === "home"
        ? ["type", "floors", "basement", "heating", "cooking", "water", "backupPower", "backupWatts", "backupWh"]
        : ["region", "setting"];
      if (!allowed.includes(field) || key.split(".").length !== 2) invalid("Unknown home/location answer state");
      if (Object.entries(record).some(([name, value]) => name === field && value !== undefined && value !== "")) invalid("Conflicting home/location answer state");
    } else {
      const person = profile.people.find(person => key === `person.${person.id}.ageRange`);
      const pet = profile.pets.find(pet => ["size", "weightLb"].some(field => key === `pet.${pet.id}.${field}`));
      const needs = profile.people.flatMap(person => Object.keys(NEEDS).map(kind => ({
        person, kind, prefix: `need.${person.id}.${kind}`,
      })));
      const need = needs.find(({ prefix }) => key === prefix || key === `${prefix}.watts` || key === `${prefix}.daysSupply`);
      if (person) {
        if (person.ageRange !== undefined) invalid("Conflicting age answer state");
      } else if (pet) {
        const field = key.endsWith(".size") ? "size" : "weightLb";
        if (pet[field] !== undefined) invalid("Conflicting pet answer state");
      } else if (need) {
        const value = need.person.needs.find(item => item.kind === need.kind);
        if (key === need.prefix) {
          if (value || need.person.absentNeeds?.some(kind => kind === need.kind)) invalid("Conflicting need answer state");
        } else if (!value || (key.endsWith(".watts") ? value.watts : value.daysSupply) !== undefined) {
          invalid("Conflicting need quantity answer state");
        }
      } else invalid("Unknown household answer state");
    }
  }
});

const planSchema: z.ZodType<PlanItem[]> = z.array(z.strictObject({
  id, text: text.min(1), source: text, kind: z.enum(["get", "plan"]).optional(),
  status: keyOf(PLAN_STATUSES), addedAt: z.iso.datetime(),
})).max(5000).refine(items => unique(items.map(item => item.id)) && unique(items.map(item => item.text)), "Duplicate plan actions");

export const householdSaveSchema = z.strictObject({
  format: z.literal("readystate-household"),
  version: z.literal(1),
  savedAt: z.iso.datetime(),
  household: profileSchema,
  plan: planSchema,
});
export type HouseholdSave = z.infer<typeof householdSaveSchema>;
export const namedSaveSchema = z.strictObject({
  id, name: z.string().trim().min(1).max(100), snapshot: householdSaveSchema,
});
export type NamedHouseholdSave = z.infer<typeof namedSaveSchema>;
export const collectionSchema = z.strictObject({ version: z.literal(1), saves: z.array(namedSaveSchema) })
  .refine(({ saves }) => unique(saves.map(save => save.id)) && unique(saves.map(save => save.name.toLocaleLowerCase())), "Duplicate named saves");

export function createHouseholdSave(household: HouseholdProfile, plan: PlanItem[]): HouseholdSave {
  // Parsing makes an independent, allowlisted snapshot, never a reference to live state.
  return householdSaveSchema.parse({ format: "readystate-household", version: 1, savedAt: new Date().toISOString(), household, plan });
}

export function parseHouseholdSave(json: string): HouseholdSave {
  if (new TextEncoder().encode(json).length > MAX_SAVE_BYTES) throw new Error("Save files must be 2 MiB or smaller.");
  let value: unknown;
  try { value = JSON.parse(json); }
  catch { throw new Error("This file is not valid JSON. Choose a ReadyState household save."); }
  const result = householdSaveSchema.safeParse(value);
  if (!result.success) throw new Error("This is not a supported ReadyState household save, or it contains invalid/conflicting answers. Nothing was loaded.");
  return result.data;
}

export function readNamedSaves(storage: Storage): NamedHouseholdSave[] {
  const raw = storage.getItem(SAVES_KEY);
  if (raw === null) return [];
  const result = collectionSchema.safeParse(JSON.parse(raw));
  if (!result.success) throw new Error("Named saves could not be read. Existing saved data has not been changed.");
  return result.data.saves;
}

export function writeNamedSaves(storage: Storage, saves: NamedHouseholdSave[]): void {
  storage.setItem(SAVES_KEY, JSON.stringify(collectionSchema.parse({ version: 1, saves })));
}

export function restoreHouseholdSave(storage: Storage, snapshot: HouseholdSave): void {
  const parsed = householdSaveSchema.parse(snapshot);
  replaceStorageEntries(storage, [
    ["readystate-household", JSON.stringify({ state: { profile: parsed.household }, version: 1 })],
    ["readystate-plan", JSON.stringify({ state: { items: parsed.plan }, version: 0 })],
  ], "household and plan");
}
