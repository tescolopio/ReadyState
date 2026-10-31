/**
 * The rules database: versioned JSON in data/rules/, validated against
 * lib/rules/schema.ts when loaded. Invalid rules fail at import (and in
 * `npm test`), never silently at runtime. See docs/architecture/rules.md.
 */
import inventoryJson from "@/data/rules/inventory.json";
import lookForsJson from "@/data/rules/look-fors.json";
import safetyJson from "@/data/rules/safety.json";
import sourcesJson from "@/data/rules/sources.json";
import {
  inventoryRuleSchema,
  lookForSchema,
  safetyRuleSchema,
  sourceSchema,
} from "@/lib/rules/schema";

export const SOURCES = sourceSchema.array().parse(sourcesJson);
export const INVENTORY_RULES = inventoryRuleSchema.array().parse(inventoryJson);
export const SAFETY_RULES = safetyRuleSchema.array().parse(safetyJson);
export const LOOK_FORS = lookForSchema.array().parse(lookForsJson);

/** Safety rules as system-prompt lines. */
export const safetyPrompt = () => SAFETY_RULES.map((rule) => `  - ${rule.prompt}`).join("\n");
