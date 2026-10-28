/**
 * The rules database: versioned JSON in data/rules/, validated against
 * lib/rules/schema.ts when loaded. Invalid rules fail at import (and in
 * `npm test`), never silently at runtime. See docs/architecture/rules.md.
 */
import guidanceJson from "@/data/rules/guidance.json";
import inventoryJson from "@/data/rules/inventory.json";
import lookForsJson from "@/data/rules/look-fors.json";
import safetyJson from "@/data/rules/safety.json";
import sourcesJson from "@/data/rules/sources.json";
import type { HouseholdProfile } from "@/lib/household";
import { evaluate, profileFacts } from "@/lib/rules/engine";
import {
  guidanceSchema,
  inventoryRuleSchema,
  lookForSchema,
  safetyRuleSchema,
  sourceSchema,
  type Guidance,
} from "@/lib/rules/schema";

export const SOURCES = sourceSchema.array().parse(sourcesJson);
export const GUIDANCE = guidanceSchema.array().parse(guidanceJson);
export const INVENTORY_RULES = inventoryRuleSchema.array().parse(inventoryJson);
export const SAFETY_RULES = safetyRuleSchema.array().parse(safetyJson);
export const LOOK_FORS = lookForSchema.array().parse(lookForsJson);

/** Safety rules as system-prompt lines. */
export const safetyPrompt = () => SAFETY_RULES.map((rule) => `  - ${rule.prompt}`).join("\n");

/** The guidance the scenario engine should apply for this household and emergency. */
export function relevantGuidance(profile: HouseholdProfile): Guidance[] {
  const facts = profileFacts(profile);
  return GUIDANCE.filter((record) => record.prompt && (!record.when || evaluate(record.when, facts)));
}

/** Guidance as baseline lines, with the publisher so feedback can say where advice comes from. */
export function describeGuidance(records: Guidance[]): string | undefined {
  if (!records.length) return undefined;
  const publisher = (id: string) => SOURCES.find((source) => source.id === id)?.publisher ?? id;
  const lines = records.map(
    (record) => `- ${record.brief ?? record.statement} (${[...new Set(record.sources.map(publisher))].join("; ")})`,
  );
  return `Official guidance to apply in outcomes and feedback:\n${lines.join("\n")}`;
}
