/**
 * Inventory check: compares a household profile with published preparedness
 * guidance, without the model. Runs after the household build (wizard Review
 * step), and its gaps are sent with the household summary so the exercise
 * can explore them.
 *
 * The checks themselves are data: data/rules/inventory.json, with their
 * sources in data/rules/sources.json (see docs/architecture/rules.md).
 */
import { describeHousehold, type HouseholdProfile } from "@/lib/household";
import { INVENTORY_RULES } from "@/lib/rules";
import { runInventoryRules, type Finding } from "@/lib/rules/engine";

export type { Finding, FindingStatus } from "@/lib/rules/engine";

export const assessInventory = (profile: HouseholdProfile): Finding[] => runInventoryRules(INVENTORY_RULES, profile);

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
