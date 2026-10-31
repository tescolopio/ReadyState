/**
 * Capture of every debrief draft, rejected ones included, for manual review
 * in local evals. Off by default: the server must set
 * READYSTATE_CAPTURE_DEBRIEF_DRAFTS=1, it is never on in hosted mode, and the
 * request must ask for it with the CAPTURE_HEADER the eval sends when
 * EVAL_CAPTURE_DRAFTS=1. The eval writes it to eval-results/ (git-ignored).
 *
 * It holds the drafts, the checks they failed and what the model was given
 * as evidence, but not the household baseline or any credential: the
 * household is identified by the eval's synthetic household id.
 */
import type { IntroducedItem } from "@/lib/continuity";
import type { DebriefProblem } from "@/lib/debrief-checks";
import type { AfterActionReport } from "@/lib/ttx";

export const CAPTURE_HEADER = "x-readystate-capture-debrief-drafts";

export interface DebriefDraft {
  attempt: "first" | "repair";
  /** "rejected" drafts were never displayed. */
  status: "accepted" | "rejected";
  report: AfterActionReport;
  failedChecks: DebriefProblem[];
  ms: number;
  usage: { inputTokens: number; outputTokens: number };
}

export interface DebriefCapture {
  provider: string;
  model: string;
  drafts: DebriefDraft[];
  /** What the model could cite: the hours in the log, and the briefing without the household baseline. */
  evidence: { hours: number[]; log: string };
  /** Known defects of the story, as given to the model in the briefing. */
  knownStoryDefects: Pick<IntroducedItem, "item" | "time" | "sentence">[];
}

export const captureEnabled = (req: Request, mode: string) =>
  mode !== "hosted" && process.env.READYSTATE_CAPTURE_DEBRIEF_DRAFTS === "1" && req.headers.get(CAPTURE_HEADER) === "1";

/** The briefing after the household baseline: the log, the latest turn and the debrief request. */
export function briefingWithoutBaseline(briefing: string) {
  const starts = ["\n\nEXERCISE LOG", "\n\nLATEST TURN", "\n\nPARTICIPANT ACTION"].map((marker) => briefing.indexOf(marker)).filter((i) => i >= 0);
  return starts.length ? briefing.slice(Math.min(...starts) + 2) : "";
}
