/**
 * Manual labels for the G11 case set (cases.ts). Only the scoring imports
 * this file; the judge never sees it. The reserved labels were fixed on
 * 2026-10-31, before any run of those cases.
 *
 * `defect` cases should be detected (contradicted or unsupported); `label` is
 * the classification manual review expects. `accurate` cases should be
 * supported. `ambiguous` cases have no single right answer and are reported,
 * not scored. `falseDetail` names the false part of a mixed claim, so the
 * report can say whether the judge flagged that part.
 */
export type Verdict = "supported" | "contradicted" | "unsupported" | "unclear";

export interface Label {
  kind: "defect" | "accurate" | "ambiguous";
  label?: Verdict;
  /** The defect type, for reporting by type; for accurate cases, what kind of text it is. */
  type: string;
  basis: "story" | "household" | "guidance";
  /** Whether a correct judgment depends on telling a forecast from an event. */
  forecast?: boolean;
  /** For a mixed claim: words from its one important false detail. */
  falseDetail?: string;
  source: string;
}

export const LABELS: Record<string, Label> = {
  // Development: Alex.
  C07: { kind: "defect", label: "contradicted", type: "heating timeline", basis: "story", forecast: true, falseDetail: "six hours later", source: "12:04 repair need_to_know[0]: heating still offline at Hour 72" },
  C02: { kind: "accurate", label: "supported", type: "participant action", basis: "story", source: "12:04 repair went_well[3]; response after Hour 60" },
  C11: { kind: "defect", label: "unsupported", type: "invented participant action", basis: "story", falseDetail: "coordinated with building staff", source: "11:42 first draft summary" },
  C04: { kind: "accurate", label: "supported", type: "forecast reported as a forecast", basis: "story", forecast: true, source: "the forecast in the log at Hour 66" },
  C15: { kind: "defect", label: "unsupported", type: "overstated duration", basis: "story", falseDetail: "several days", source: "12:04 first draft need_to_know[0]: 45 °F reported from Hour 60 into the Hour 72 turn" },
  C09: { kind: "accurate", label: "supported", type: "accurate rewrite (heating timeline)", basis: "story", source: "rewrite of C07" },
  C13: { kind: "ambiguous", type: "timeline understatement (finding 32)", basis: "story", source: "11:35 displayed need_to_know[0]" },
  C21: { kind: "accurate", label: "supported", type: "harmless paraphrase (heating timeline)", basis: "story", source: "paraphrase of C09" },
  C18: { kind: "defect", label: "contradicted", type: "forecast as event", basis: "story", forecast: true, falseDetail: "restored at Hour 66", source: "variation of the 12:04 contradiction" },
  C25: { kind: "defect", label: "contradicted", type: "equipment provenance", basis: "story", falseDetail: "you kept", source: "variation of the invented heater: it came from the maintenance closet at Hour 72" },
  C16: { kind: "defect", label: "contradicted", type: "outage length", basis: "story", falseDetail: "72-hour", source: "12:04 repair need_to_know[1]: power returned at Hour 60" },
  C23: { kind: "defect", label: "contradicted", type: "contradicted risk", basis: "story", falseDetail: "never at risk", source: "Hour 48 and Hour 72 hypothermia alerts" },
  C19: { kind: "defect", label: "unsupported", type: "causal conclusion", basis: "story", falseDetail: "cannot support", source: "12:04 and 04:07 first drafts" },
  C26: { kind: "ambiguous", type: "opinion of others' handling", basis: "story", source: "written for the case set" },
  // Accurate rewrites for the pilot (2026-10-31), each correcting one missed defect's false detail.
  C56: { kind: "accurate", label: "supported", type: "accurate rewrite (equipment provenance)", basis: "story", source: "rewrite of C25; Hour 72 outcome: stored in the building's maintenance closet, the breaker trips twice" },
  C57: { kind: "accurate", label: "supported", type: "accurate rewrite (outage length)", basis: "story", source: "rewrite of C16; baseline Stored: about 1.0 days; Hour 60 situation: power is restored" },
  C58: { kind: "accurate", label: "supported", type: "accurate rewrite (causal conclusion)", basis: "story", source: "rewrite of C19; Hour 72 outcome: plugged in, tripped, reset, tripped again" },
  C05: { kind: "defect", label: "unsupported", type: "electric heaters and CO (guidance)", basis: "guidance", falseDetail: "produce carbon monoxide", source: "04:07 first draft do_better[2].why; the supplied guidance doesn't say electric heaters produce CO" },
  C01: { kind: "accurate", label: "supported", type: "household fact", basis: "household", source: "baseline: Stored" },
  C08: { kind: "accurate", label: "supported", type: "guidance paraphrase", basis: "guidance", source: "guidance: CO detectors" },
  C22: { kind: "defect", label: "contradicted", type: "contradicted household fact", basis: "household", falseDetail: "no flashlights", source: "baseline: Has flashlights" },
  C17: { kind: "defect", label: "contradicted", type: "contradicted guidance", basis: "guidance", falseDetail: "about a week", source: "guidance: a closed full freezer about 48 h" },
  C24: { kind: "accurate", label: "supported", type: "guidance paraphrase", basis: "guidance", source: "guidance: hypothermia can occur above 40 °F if wet" },
  C20: { kind: "ambiguous", type: "opinion beyond the supplied guidance", basis: "guidance", source: "the supplied guidance doesn't cover heaters; the safety rules aren't supplied" },

  // Reserved: Charlotte.
  C41: { kind: "defect", label: "contradicted", type: "mixed: quantity", basis: "story", falseDetail: "six hours", source: "Hour 18 outcome: the CPAP ran about two hours on the neighbor's generator" },
  C33: { kind: "accurate", label: "supported", type: "causal statement the log makes", basis: "story", source: "Hour 6 outcome: turning off the main gas valve eliminated the gas-leak risk" },
  C47: { kind: "defect", label: "contradicted", type: "mixed: equipment provenance", basis: "story", falseDetail: "your own car", source: "response after Hour 24 and Hour 30 outcome: the neighbor's car" },
  C30: { kind: "defect", label: "contradicted", type: "forecast as event", basis: "story", forecast: true, falseDetail: "by Hour 12", source: "the debrief's need_to_know[2] (2026-10-30): at Hour 12 the water was only projected to reach the hallway; it covered it at Hour 24" },
  C52: { kind: "accurate", label: "supported", type: "harmless paraphrase", basis: "story", source: "Hour 60 outcome: 50 Wh, insufficient for the 60 W CPAP without an inverter" },
  C38: { kind: "ambiguous", type: "loose duration from a debrief", basis: "story", source: "the debrief's need_to_know[0]: the station was at 4 % from Hour 6 and kept for the phone, never said to run out" },
  C44: { kind: "defect", label: "contradicted", type: "mixed: causal conclusion", basis: "story", falseDetail: "kept the medical device's battery from draining", source: "Hour 0 situation: the device's battery was already depleted" },
  C35: { kind: "accurate", label: "supported", type: "participant action", basis: "story", source: "the participant's call, in the log after Hour 66" },
  C49: { kind: "defect", label: "contradicted", type: "invented participant action", basis: "story", source: "Hour 42 outcome: no inverter, no power supplied" },
  C31: { kind: "accurate", label: "supported", type: "forecast reported as a forecast", basis: "story", forecast: true, source: "the clinic staff's warning in the log at Hour 66" },
  C55: { kind: "defect", label: "unsupported", type: "forecast as event", basis: "story", forecast: true, source: "Hour 72: told to keep the CPAP on the generator as long as fuel lasts; it never says the fuel ran out" },
  C42: { kind: "ambiguous", type: "causal claim from a debrief", basis: "story", source: "the debrief's went_well[2]: the dispatcher did say to keep the CPAP on the generator as long as fuel lasts, but the CPAP was off for most of the exercise" },
  C37: { kind: "accurate", label: "supported", type: "household fact", basis: "household", source: "baseline: Stored (5.0 days before pets) and Gaps (about 2.5 days)" },
  C50: { kind: "defect", label: "contradicted", type: "mixed: household fact", basis: "household", falseDetail: "no first aid kit", source: "baseline: Has lists a first aid kit" },
  C46: { kind: "accurate", label: "supported", type: "guidance paraphrase", basis: "guidance", source: "guidance: generators outdoors only, 20+ ft away" },

  // Reserved: Priya.
  C34: { kind: "accurate", label: "supported", type: "accurate detail-rich claim", basis: "story", source: "the cooling-center outcome in the log at Hour 10" },
  C53: { kind: "defect", label: "contradicted", type: "mixed: time", basis: "story", falseDetail: "two hours", source: "Hour 10 outcome: about 20 minutes" },
  C39: { kind: "defect", label: "contradicted", type: "mixed: actor", basis: "story", falseDetail: "the neighbor moved", source: "Hour 26 the neighbor offered; Hour 28 outcome: you moved it" },
  C45: { kind: "accurate", label: "supported", type: "water left, from the log", basis: "story", source: "the water left, in the log at Hour 20" },
  C32: { kind: "defect", label: "contradicted", type: "equipment provenance", basis: "story", falseDetail: "your own", source: "Hours 12–14: the neighbor's generator" },
  C48: { kind: "accurate", label: "supported", type: "causal statement the log makes", basis: "story", source: "Hour 22 outcome: the battery, low from earlier inverter use, can't start the car" },
  C36: { kind: "ambiguous", type: "conflicting log", basis: "story", source: "Hour 14 outcome restores power but the Hour 14 alert says still offline; the generator was switched off after Hour 30" },
  C51: { kind: "accurate", label: "supported", type: "participant action", basis: "story", source: "response after Hour 28; Hour 30 outcome" },
  C43: { kind: "ambiguous", type: "opinion", basis: "story", source: "written for the case set" },
  C40: { kind: "accurate", label: "supported", type: "household fact", basis: "household", source: "baseline: People" },
  C54: { kind: "accurate", label: "supported", type: "guidance paraphrase", basis: "guidance", source: "guidance: heat exhaustion, get help if over 1 h" },
  C29: { kind: "defect", label: "contradicted", type: "mixed: guidance", basis: "guidance", falseDetail: "only if", source: "guidance: heat stroke, call 911 and cool" },
};
