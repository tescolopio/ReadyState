import { describe, expect, it } from "vitest";

import { NEEDS, SCENARIOS, SUPPLY_ITEMS } from "@/lib/household";
import { GUIDANCE, INVENTORY_RULES, LOOK_FORS, SAFETY_RULES, SOURCES } from "@/lib/rules";
import {
  NEED_FACTS,
  PROFILE_FACTS,
  conditionFacts,
  evaluate,
  render,
  templateFacts,
  type Facts,
} from "@/lib/rules/engine";
import type { Condition } from "@/lib/rules/schema";

const SUPPLY_IDS = new Set(Object.values(SUPPLY_ITEMS).flatMap((group) => Object.keys(group)));
const NEED_IDS = new Set(Object.keys(NEEDS));
const SCENARIO_IDS = new Set(Object.keys(SCENARIOS));
/** Placeholders the engine supplies itself when rendering. */
const RENDER_FACTS = new Set(["days", "shortBy", "shortByGallons", "missingCount", "total", "missingList"]);

const allRules = [...INVENTORY_RULES, ...SAFETY_RULES, ...LOOK_FORS, ...GUIDANCE];

/** Values a condition compares supplies, needs and scenarios against, which must be real ids. */
function comparedIds(condition: Condition): Array<{ fact: string; value: string }> {
  if ("all" in condition) return condition.all.flatMap(comparedIds);
  if ("any" in condition) return condition.any.flatMap(comparedIds);
  if ("not" in condition) return comparedIds(condition.not);
  const values =
    "includes" in condition ? [condition.includes]
    : "includesAll" in condition ? condition.includesAll
    : "includesAny" in condition ? condition.includesAny
    : "in" in condition ? condition.in.map(String)
    : "equals" in condition && typeof condition.equals === "string" ? [condition.equals]
    : [];
  return values.map((value) => ({ fact: condition.fact, value }));
}

const ID_SETS: Record<string, Set<string>> = {
  "supplies.have": SUPPLY_IDS,
  "needs.kinds": NEED_IDS,
  "need.kind": NEED_IDS,
  scenario: SCENARIO_IDS,
};

describe("rules database", () => {
  it("has unique ids within each file", () => {
    for (const rules of [INVENTORY_RULES, SAFETY_RULES, LOOK_FORS, SOURCES]) {
      const ids = rules.map((rule) => rule.id);
      expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    }
  });

  it("cites only sources in the registry", () => {
    const known = new Set(SOURCES.map((source) => source.id));
    const unknown = allRules.flatMap((rule) => rule.sources.filter((id) => !known.has(id)).map((id) => `${rule.id}: ${id}`));
    expect(unknown).toEqual([]);
  });

  it("marks reviewed rules with a reviewer", () => {
    expect(allRules.filter((rule) => rule.status === "reviewed" && !rule.reviewedBy).map((rule) => rule.id)).toEqual([]);
  });

  it("uses only facts the engine provides, in conditions and templates", () => {
    const problems: string[] = [];
    for (const rule of INVENTORY_RULES) {
      const facts = new Set([...Object.keys(PROFILE_FACTS), ...(rule.forEach === "need" ? Object.keys(NEED_FACTS) : []), ...RENDER_FACTS]);
      const conditions = [rule.when, rule.type === "check" ? rule.pass : undefined].filter((c): c is Condition => Boolean(c));
      const templates = [
        rule.findingId ?? "",
        ...(rule.type === "supply" ? [...Object.values(rule.messages), ...Object.values(rule.actions)] : []),
        ...(rule.type === "check" ? [rule.finding, rule.action] : []),
        ...(rule.type === "kit" ? [rule.finding, rule.action, rule.okFinding] : []),
      ].filter((t): t is string => typeof t === "string");
      const used = [...conditions.flatMap(conditionFacts), ...templates.flatMap(templateFacts), ...(rule.type === "supply" ? [rule.metric] : [])];
      problems.push(...used.filter((fact) => !facts.has(fact)).map((fact) => `${rule.id}: ${fact}`));
    }
    for (const lookFor of LOOK_FORS) {
      if (!lookFor.when) continue;
      problems.push(...conditionFacts(lookFor.when).filter((fact) => !(fact in PROFILE_FACTS)).map((fact) => `${lookFor.id}: ${fact}`));
    }
    expect(problems).toEqual([]);
  });

  it("compares supplies, needs and scenarios only against real ids", () => {
    const conditions = [
      ...INVENTORY_RULES.flatMap((rule) => [rule.when, rule.type === "check" ? rule.pass : undefined]),
      ...LOOK_FORS.map((lookFor) => lookFor.when),
    ].filter((c): c is Condition => Boolean(c));
    const bad = conditions
      .flatMap(comparedIds)
      .filter(({ fact, value }) => ID_SETS[fact] && !ID_SETS[fact].has(value))
      .map(({ fact, value }) => `${fact}: ${value}`);
    const kitItems = INVENTORY_RULES.flatMap((rule) => (rule.type === "kit" ? Object.keys(rule.items) : []));
    expect([...bad, ...kitItems.filter((id) => !SUPPLY_IDS.has(id))]).toEqual([]);
    expect(LOOK_FORS.flatMap((lookFor) => lookFor.scenarios).filter((id) => !SCENARIO_IDS.has(id))).toEqual([]);
  });

  it("compiles every safety pattern", () => {
    for (const rule of SAFETY_RULES) {
      for (const pattern of [...(rule.detect ?? []), ...(rule.exceptWhen ? [rule.exceptWhen] : [])]) {
        expect(() => new RegExp(pattern, "i"), `${rule.id}: ${pattern}`).not.toThrow();
      }
    }
  });
});

describe("safety detection", () => {
  const rule = SAFETY_RULES.find((r) => r.id === "no-indoor-combustion")!;
  const flags = (sentence: string) =>
    rule.detect!.some((p) => new RegExp(p, "i").test(sentence)) && !new RegExp(rule.exceptWhen!, "i").test(sentence);

  it("flags advice to burn fuel indoors and lets warnings through", () => {
    expect(flags("Light the gas stove in the insulated room to raise the temperature.")).toBe(true);
    expect(flags("Running a generator indoors creates a high risk of carbon monoxide poisoning.")).toBe(false);
    expect(flags("Move the generator outside, away from windows.")).toBe(false);
  });
});

describe("rules engine", () => {
  const facts: Facts = { "pets.any": true, "home.floors": 2, "supplies.have": ["cooler"], "supplies.absent": ["ice-packs"], "need.kwhPerDay": undefined };

  it("renders placeholders and optional sections", () => {
    expect(render("per day{pets.any?, plus extra for pets}", facts)).toBe("per day, plus extra for pets");
    expect(render("in a {home.floors}-floor home", facts)).toBe("in a 2-floor home");
    expect(render("none.{need.kwhPerDay? It needs {need.kwhPerDay} kWh.}", facts)).toBe("none.");
  });

  it("evaluates nested conditions", () => {
    expect(
      evaluate({ all: [{ fact: "supplies.have", includes: "cooler" }, { not: { fact: "supplies.have", includes: "ice-packs" } }] }, facts),
    ).toBe(true);
    expect(evaluate({ any: [{ fact: "home.floors", gt: 2 }, { fact: "pets.any", exists: false }] }, facts)).toBe(false);
  });
});

describe("safety detection, more cases", () => {
  const rule = SAFETY_RULES.find((r) => r.id === "no-indoor-combustion")!;
  const flags = (sentence: string) =>
    rule.detect!.some((p) => new RegExp(p, "i").test(sentence)) && !new RegExp(rule.exceptWhen!, "i").test(sentence);

  it("catches indoor heating advice phrased in different ways", () => {
    expect(flags("Use the oven to warm the kitchen for a few hours.")).toBe(true);
    expect(flags("Run the propane heater in the living room overnight.")).toBe(true);
    expect(flags("Cook on the camp stove outdoors.")).toBe(false);
  });
});

describe("guidance", () => {
  const sourceById = new Map(SOURCES.map((source) => [source.id, source]));

  it("has unique ids, known sources and known facts", () => {
    const ids = GUIDANCE.map((record) => record.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    expect(GUIDANCE.flatMap((r) => r.sources.filter((id) => !sourceById.has(id)).map((id) => `${r.id}: ${id}`))).toEqual([]);
    const facts = GUIDANCE.flatMap((r) => (r.when ? conditionFacts(r.when) : []));
    expect(facts.filter((fact) => !(fact in PROFILE_FACTS))).toEqual([]);
  });

  it("quotes only public-domain sources, never copyrighted ones", () => {
    const bad = GUIDANCE.filter(
      (r) => r.quote && !r.sources.some((id) => sourceById.get(id)?.license === "public-domain"),
    ).map((r) => r.id);
    expect(bad).toEqual([]);
  });

  it("gives every record sent to the model a short brief", () => {
    expect(GUIDANCE.filter((r) => r.prompt && !r.brief).map((r) => r.id)).toEqual([]);
    expect(GUIDANCE.filter((r) => r.brief && r.brief.split(/\s+/).length > 30).map((r) => r.id)).toEqual([]);
  });

  it("links inventory rules only to guidance that exists, with matching thresholds", () => {
    const byId = new Map(GUIDANCE.map((record) => [record.id, record]));
    const problems: string[] = [];
    for (const rule of INVENTORY_RULES) {
      if (!rule.guidance) continue;
      const record = byId.get(rule.guidance);
      if (!record) {
        problems.push(`${rule.id}: no guidance "${rule.guidance}"`);
        continue;
      }
      if (rule.type !== "supply") continue;
      if (record.values.minimumDays !== undefined && record.values.minimumDays !== rule.minimum) {
        problems.push(`${rule.id}: minimum ${rule.minimum} but ${record.id} says ${record.values.minimumDays}`);
      }
      if (record.values.goalDays !== undefined && rule.goal !== undefined && record.values.goalDays !== rule.goal) {
        problems.push(`${rule.id}: goal ${rule.goal} but ${record.id} says ${record.values.goalDays}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("outage heating detection", () => {
  const rule = SAFETY_RULES.find((r) => r.id === "outage-appropriate-heating")!;
  const flags = (sentence: string) =>
    rule.detect!.some((p) => new RegExp(p, "i").test(sentence)) && !new RegExp(rule.exceptWhen!, "i").test(sentence);

  it("flags an electric heater recommended for outages even when 'not' appears elsewhere", () => {
    expect(flags("Buy an electric space heater for future power outages, not candles.")).toBe(true);
    expect(flags("Keep a UL-listed electric heater ready for power outages.")).toBe(true);
  });

  it("lets warnings about electric heat in outages through", () => {
    expect(flags("An electric space heater won't help during a power outage.")).toBe(false);
    expect(flags("Don't count on electric heaters in a power outage.")).toBe(false);
    expect(flags("Electric heaters need grid power, so they're useless in a power outage.")).toBe(false);
  });
});
