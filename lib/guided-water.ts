import { z } from "zod";

import type { HouseholdProfile } from "@/lib/household";

export const LITRES_PER_US_GALLON = 3.785411784;
export const WATER_CONTAINERS = [
  { id: "bottle500", label: "500 mL bottle", litres: 0.5, shape: "bottle" },
  { id: "bottle1000", label: "1 litre bottle", litres: 1, shape: "bottle" },
  { id: "gallon1", label: "1 US gallon container", litres: LITRES_PER_US_GALLON, shape: "jug" },
  { id: "gallon5", label: "5 US gallon container", litres: 5 * LITRES_PER_US_GALLON, shape: "jug" },
] as const;
export type WaterContainerId = (typeof WATER_CONTAINERS)[number]["id"];
const count = z.string().max(8).refine(value => value === "" || /^\d{1,6}$/.test(value), "Enter a whole number from 0 to 999999.");
export const guidedAssessmentSchema = z.strictObject({
  mode: z.enum(["simple", "guided"]),
  screen: z.enum(["topics", "water", "results"]),
  waterStarted: z.boolean(),
  entry: z.enum(["question", "amount", "count"]),
  counts: z.strictObject({ bottle500: count, bottle1000: count, gallon1: count, gallon5: count }),
  reviewedWater: z.string().max(200_000).nullable(),
});
export type GuidedAssessment = z.infer<typeof guidedAssessmentSchema>;
export const emptyGuidedAssessment = (): GuidedAssessment => ({
  mode: "simple", screen: "topics", waterStarted: false, entry: "question",
  counts: { bottle500: "", bottle1000: "", gallon1: "", gallon5: "" },
  reviewedWater: null,
});
export function countedWater(counts: GuidedAssessment["counts"]) {
  const parsed = guidedAssessmentSchema.shape.counts.parse(counts);
  const gallons = WATER_CONTAINERS.reduce((total, container) =>
    total + Number(parsed[container.id] || 0) * (container.litres / LITRES_PER_US_GALLON), 0);
  return { litres: gallons * LITRES_PER_US_GALLON, gallons };
}
/** Review is about the answers/context seen, not certification or question completion. */
export function waterReviewKey(profile: HouseholdProfile): string {
  return JSON.stringify({
    people: profile.people.length, pets: profile.pets.map(pet => ({ kind: pet.kind, weightLb: pet.weightLb })),
    water: profile.supplies.waterGallons ?? null,
    answer: profile.answers?.["supplies.waterGallons"] ?? null,
    source: profile.home.water ?? null, power: profile.home.backupPower ?? null,
  });
}
export function waterTopicStatus(profile: HouseholdProfile, reviewed: string | null, started = false) {
  if (reviewed === waterReviewKey(profile)) return "Reviewed";
  if (reviewed !== null) return "Needs review";
  if (profile.supplies.waterGallons !== undefined || profile.answers?.["supplies.waterGallons"]) {
    return profile.supplies.waterGallons === undefined || !profile.people.length ||
      profile.pets.some(pet => (pet.kind === "dog" || pet.kind === "cat") && !pet.weightLb)
      ? "Needs a few answers" : "Started";
  }
  return started ? "Started" : "Not started";
}
