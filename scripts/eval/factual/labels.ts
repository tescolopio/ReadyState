/**
 * Manual labels for the G11 case set (cases.ts). Only the scoring imports
 * this file; the judge never sees it.
 *
 * `defect` cases should be caught as contradicted or unsupported; `label` is
 * the verdict manual review expects, and the other of the two still counts as
 * caught. `accurate` cases should be supported. `ambiguous` cases have no
 * right answer and are reported, not scored.
 */
export type Verdict = "supported" | "contradicted" | "unsupported" | "unclear";

export interface Label {
  kind: "defect" | "accurate" | "ambiguous";
  label?: Verdict;
  /** The defect type, for reporting missed defects by type; for accurate cases, what kind of text it is. */
  type: string;
  basis: "story" | "household" | "guidance";
  /** Whether a correct judgment depends on telling a forecast from an event. */
  forecast?: boolean;
  source: string;
}

export const LABELS: Record<string, Label> = {
  C07: { kind: "defect", label: "contradicted", type: "heating timeline", basis: "story", forecast: true, source: "12:04 repair need_to_know[0]: heating still offline at Hour 72" },
  C02: { kind: "accurate", label: "supported", type: "participant action", basis: "story", source: "12:04 repair went_well[3]; response after Hour 60" },
  C11: { kind: "defect", label: "unsupported", type: "invented participant action", basis: "story", source: "11:42 first draft summary" },
  C04: { kind: "accurate", label: "supported", type: "forecast reported as a forecast", basis: "story", forecast: true, source: "the forecast in the log at Hour 66" },
  C15: { kind: "defect", label: "unsupported", type: "overstated duration", basis: "story", source: "12:04 first draft need_to_know[0]: 45 °F reported from Hour 60 into the Hour 72 turn" },
  C09: { kind: "accurate", label: "supported", type: "accurate rewrite (heating timeline)", basis: "story", source: "rewrite of C07" },
  C13: { kind: "ambiguous", type: "timeline understatement (finding 32)", basis: "story", source: "11:35 displayed need_to_know[0]" },
  C21: { kind: "accurate", label: "supported", type: "harmless paraphrase (heating timeline)", basis: "story", source: "paraphrase of C09" },
  C18: { kind: "defect", label: "contradicted", type: "forecast as event", basis: "story", forecast: true, source: "variation of the 12:04 contradiction" },
  C25: { kind: "defect", label: "contradicted", type: "invented equipment", basis: "story", source: "variation of the invented heater: it came from the maintenance closet at Hour 72" },
  C16: { kind: "defect", label: "contradicted", type: "outage length", basis: "story", source: "12:04 repair need_to_know[1]: power returned at Hour 60" },
  C23: { kind: "defect", label: "contradicted", type: "contradicted risk", basis: "story", source: "Hour 48 and Hour 72 hypothermia alerts" },
  C19: { kind: "defect", label: "unsupported", type: "unsupported electrical conclusion", basis: "story", source: "12:04 and 04:07 first drafts" },
  C26: { kind: "ambiguous", type: "opinion of others' handling", basis: "story", source: "written for the case set" },
  C05: { kind: "defect", label: "unsupported", type: "electric heaters and CO", basis: "guidance", source: "04:07 first draft do_better[2].why; the guidance doesn't say electric heaters produce CO" },
  C01: { kind: "accurate", label: "supported", type: "household fact", basis: "household", source: "baseline: Stored" },
  C08: { kind: "accurate", label: "supported", type: "guidance paraphrase", basis: "guidance", source: "guidance: CO detectors" },
  C22: { kind: "defect", label: "contradicted", type: "contradicted household fact", basis: "household", source: "baseline: Has flashlights" },
  C17: { kind: "defect", label: "contradicted", type: "contradicted guidance", basis: "guidance", source: "guidance: a closed full freezer about 48 h" },
  C24: { kind: "accurate", label: "supported", type: "guidance paraphrase", basis: "guidance", source: "guidance: hypothermia can occur above 40 °F if wet" },
  C20: { kind: "ambiguous", type: "opinion beyond the supplied guidance", basis: "guidance", source: "the supplied guidance doesn't cover heaters; the safety rules aren't supplied" },
};
