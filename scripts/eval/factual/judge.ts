/**
 * An eval-only factual-consistency judge (work item G11). It is not used by
 * the server. It sees the claims and the evidence, never the manual labels.
 *
 * The contract, revised after the first run (2026-10-31):
 * - Each claim is split into its material assertions (actor, action, time,
 *   quantity, equipment provenance, causal conclusion, state), each judged
 *   with its own evidence. The claim's verdict is derived from them here: a
 *   claim is supported only when every assertion is.
 * - "unsupported" must name the evidence searched and what is missing.
 * - Every STORY FACTS line is checked against the log, separately from the
 *   claims.
 * - Outside knowledge can't make an assertion contradicted: it then counts as
 *   unsupported, and the misclassification is reported.
 * Results that break the contract (unknown or missing references, a verdict
 * its own assertions don't give) are invalid, not scored as right or wrong.
 */
import { generateText, tool, type LanguageModel } from "ai";
import { z } from "zod";

import { storyDefects } from "@/lib/debrief-checks";
import alexReplay from "@/lib/fixtures/alex-replay-turns.json";
import { engineBaseline } from "@/lib/inventory";
import { GUIDANCE } from "@/lib/rules";
import { storyFacts, storyFactsBriefing } from "@/lib/story-facts";
import { TEST_HOUSEHOLDS } from "@/lib/test-households";
import type { TurnOutput } from "@/lib/ttx";

import type { Batch, Household } from "./cases";
import charlotte from "./fixtures/charlotte.json";
import priya from "./fixtures/priya.json";

export const VERDICTS = ["supported", "contradicted", "unsupported", "unclear"] as const;
export type JudgeVerdict = (typeof VERDICTS)[number];
export const ASSERTION_KINDS = ["actor", "action", "time", "quantity", "provenance", "cause", "state", "other"] as const;

const assertionSchema = z.object({
  kind: z.enum(ASSERTION_KINDS),
  text: z.string().describe("The assertion, in at most 15 words."),
  verdict: z.enum(VERDICTS),
  evidence: z.array(z.string()).describe("References of the lines that support or contradict it, exactly as written in brackets."),
  searched: z.array(z.string()).describe("For unsupported: the references or sections you searched. Otherwise empty."),
  missing: z.string().describe("For unsupported: what the evidence would need to say. Otherwise empty."),
  outside_knowledge: z.boolean().describe("True if the verdict relies on anything not in the evidence."),
});

export const judgmentSchema = z.object({
  note_check: z
    .array(
      z.object({
        line: z.string().describe('The note line\'s reference, e.g. "Note 2".'),
        consistent: z.boolean(),
        log_references: z.array(z.string()),
        explanation: z.string().describe("At most 25 words."),
      }),
    )
    .describe("One entry for every STORY FACTS line, checked against the log. Empty if no note was given."),
  claims: z.array(
    z.object({
      id: z.string(),
      claim: z.string().describe("The claim, quoted exactly as given."),
      basis: z.enum(["story", "household", "guidance"]),
      assertions: z.array(assertionSchema).describe("Every material assertion in the claim."),
      verdict: z.enum(VERDICTS).describe("supported only if every assertion is; contradicted if any is; else unsupported if any is; else unclear."),
      explanation: z.string().describe("At most 25 words."),
    }),
  ),
});
export type Judgment = z.infer<typeof judgmentSchema>;
export type JudgedClaim = Judgment["claims"][number];
export type JudgedAssertion = JudgedClaim["assertions"][number];

export const JUDGE_INSTRUCTIONS = `You check claims from the debrief of a household emergency exercise against the evidence given, and nothing else.

First, check every STORY FACTS line against the log, if a note is given. The note is derived from the log by software and may be wrong. For each line, say whether the log is consistent with it, citing the log lines. Do this even when you could judge every claim without the note.

Then, for each claim:
1. Split it into its material assertions: who acted (actor), what was done (action), when (time), how much or how long (quantity), whose equipment it was or where it came from (provenance), what caused what (cause), and what was the case (state). A claim's details are each an assertion.
2. Judge each assertion:
   - supported: the evidence states it, or it follows directly.
   - contradicted: the evidence states something incompatible with it.
   - unsupported: the evidence neither states nor implies it, and doesn't contradict it. List what you searched and what is missing.
   - unclear: too vague or evaluative to check, or the evidence conflicts with itself.
   Cite evidence by the references in brackets, exactly as written.
3. The claim's verdict follows from its assertions: supported only if every assertion is supported; contradicted if any is contradicted; otherwise unsupported if any is unsupported; otherwise unclear.

Rules:
- Each claim has one basis: story (the exercise log), household (the baseline) or guidance (the approved guidance). The story can't establish a guidance fact, and guidance can't establish what happened.
- Use only the evidence given. Knowledge from outside it can't make an assertion contradicted or supported; if you notice such knowledge, the assertion is unsupported, and set outside_knowledge.
- A forecast ("will be restored in about six hours", "could run out within two hours") is not an event. Never treat a forecast as having happened.
- The participant's actions are only what their responses say. Story events and other people's actions are not the participant's.
- For story claims, judge by the log, not the note.
- Missing evidence is unknown. Some hours' outcomes are omitted, and the log doesn't record everything: the absence of a line never shows that something didn't happen, so it can't make an assertion contradicted.
- Quote each claim exactly.`;

interface HouseholdEvidence {
  baseline: string;
  turns: TurnOutput[];
  responses: string[];
}

const EVIDENCE: Record<Household, () => HouseholdEvidence> = {
  alex: () => ({
    baseline: engineBaseline(TEST_HOUSEHOLDS.find((household) => household.id === "alex")!.profile).split(/\nOfficial guidance/)[0],
    turns: alexReplay.turns as TurnOutput[],
    responses: alexReplay.responses,
  }),
  charlotte: () => ({ baseline: charlotte.baseline, turns: charlotte.turns as TurnOutput[], responses: charlotte.responses }),
  priya: () => ({ baseline: priya.baseline, turns: priya.turns as TurnOutput[], responses: priya.responses }),
};

/** A household's baseline lines, labeled for citing; the first line of each person or pet block keeps its sub-lines. */
const baselineLines = (baseline: string) =>
  baseline
    .split("\n")
    .filter(Boolean)
    .map((line) => (line.startsWith("- ") ? line : `[Baseline: ${line.split(":")[0]}] ${line}`))
    .map((line) => (line.startsWith("- ") ? `  ${line}` : line));

/** The approved guidance, numbered for citing. */
export const guidanceLines = () =>
  GUIDANCE.map((guidance) => guidance.brief)
    .filter(Boolean)
    .map((brief, i) => `[Guidance ${i + 1}] ${brief}`);

/** A turn's situation without its offered choices, which are options, not events. */
const withoutChoices = (text: string) =>
  text.replace(/\s*(You (must|need to|have to) (now )?(decide|choose)|Decide whether|Choose whether|They suggest three options|Options include)[\s\S]*$/, "").trim();

function logLines(omitHours: number[], { turns, responses }: HouseholdEvidence) {
  return turns.flatMap((turn, i) => {
    const hour = turn.hours_elapsed;
    const omitted = omitHours.includes(hour);
    const situation = omitted ? "" : withoutChoices(turn.new_inject ?? "");
    return [
      turn.narrative_response && !omitted ? `[Hour ${hour} outcome] ${turn.narrative_response}` : "",
      situation ? `[Hour ${hour} situation] ${situation}` : "",
      turn.critical_alerts.length ? `[Hour ${hour} alerts] ${turn.critical_alerts.join(" ")}` : "",
      responses[i] ? `[Response after Hour ${hour}] ${responses[i]}` : "",
    ].filter(Boolean);
  });
}

/** The story-facts note's bullet lines, after any deliberate corruption. */
export function noteLines(batch: Batch): { lines: string[]; corrupted?: number } {
  const evidence = EVIDENCE[batch.household]();
  const note = storyFactsBriefing(storyFacts(evidence.turns, storyDefects(evidence.turns, { baseline: evidence.baseline, participantText: evidence.responses })));
  let lines = note.split("\n").slice(1).map((line) => line.trim().replace(/^- /, ""));
  let corrupted: number | undefined;
  const { find, replace, add } = batch.corruptNote ?? {};
  if (find && replace) {
    corrupted = lines.findIndex((line) => line.includes(find));
    if (corrupted < 0) throw new Error(`${batch.name}: the note has no line with "${find}"`);
    lines = lines.map((line, i) => (i === corrupted ? line.replace(find, replace) : line));
  }
  if (add) {
    // Before the last line, so it isn't the obvious odd one out at the end.
    corrupted = lines.length - 1;
    lines = [...lines.slice(0, -1), add.replace(/^- /, ""), ...lines.slice(-1)];
  }
  return { lines, corrupted };
}

/** The judge's message for a batch, and every reference it may cite. */
export function batchPrompt(batch: Batch): { text: string; references: Set<string>; noteRefs: string[] } {
  const evidence = EVIDENCE[batch.household]();
  const sections: string[] = [];
  if (batch.evidence === "story") {
    // Story claims get the household facts the log refers to, without the inventory gaps, to stay under the token limit.
    sections.push(`HOUSEHOLD BASELINE:\n${baselineLines(evidence.baseline).filter((line) => !line.startsWith("[Baseline: Gaps")).join("\n")}`);
    const omitted = batch.omitHours ?? [];
    sections.push(
      `EXERCISE LOG ("Response after Hour N" is the participant's own message; the next hour's outcome follows from it.${omitted.length ? ` Outcomes and situations for Hours ${omitted.join(", ")} are omitted for length; every response and alert is included.` : ""}):\n${logLines(omitted, evidence).join("\n")}`,
    );
    const { lines } = noteLines(batch);
    sections.push(`STORY FACTS (derived from the log by software; may be wrong):\n${lines.map((line, i) => `[Note ${i + 1}] ${line}`).join("\n")}`);
  } else {
    sections.push(`HOUSEHOLD BASELINE:\n${baselineLines(evidence.baseline).join("\n")}`, `APPROVED GUIDANCE:\n${guidanceLines().join("\n")}`);
  }
  const claims = batch.cases.map(({ id, claim }) => `${id}: ${claim}`).join("\n");
  const text = `${sections.join("\n\n")}\n\nCLAIMS (judge each; quote it exactly):\n${claims}`;
  const references = new Set([...text.matchAll(/^\s*\[([^\]]+)\]/gm)].map((match) => match[1]));
  return { text, references, noteRefs: [...references].filter((ref) => ref.startsWith("Note ")) };
}

/** References that count as evidence for a basis: the log for story claims (not the derived note), and so on. */
const BASIS_REFS: Record<JudgedClaim["basis"], (ref: string) => boolean> = {
  story: (ref) => /^(Hour \d+ (outcome|situation|alerts)|Response after Hour \d+)$/.test(ref),
  household: (ref) => ref.startsWith("Baseline: "),
  guidance: (ref) => ref.startsWith("Guidance "),
};

/** The claim verdict its assertions give. */
export function derivedVerdict(verdicts: JudgeVerdict[]): JudgeVerdict {
  if (!verdicts.length) return "unclear";
  if (verdicts.includes("contradicted")) return "contradicted";
  if (verdicts.includes("unsupported")) return "unsupported";
  if (verdicts.includes("unclear")) return "unclear";
  return "supported";
}

export interface ValidatedClaim {
  id: string;
  judged?: JudgedClaim;
  /** Contract breaks that make the result invalid. */
  invalid: string[];
  /** Assertions marked contradicted on outside knowledge or without basis evidence: counted as unsupported. */
  boundaryViolations: string[];
  /** The verdict after enforcing the evidence boundary, when the result is valid. */
  verdict?: JudgeVerdict;
}

const normalize = (ref: string) => ref.trim().replace(/^\[|\]$/g, "");

/** Checks a batch's judgment against the contract, claim by claim. */
export function validate(batch: Batch, judgment: Judgment): { claims: ValidatedClaim[]; extra: string[] } {
  const { references } = batchPrompt(batch);
  const byId = new Map(judgment.claims.map((claim) => [claim.id, claim]));
  const claims = batch.cases.map(({ id, claim }): ValidatedClaim => {
    const judged = byId.get(id);
    if (!judged) return { id, invalid: ["no verdict"], boundaryViolations: [] };
    const invalid: string[] = [];
    const boundaryViolations: string[] = [];
    if (judged.claim.trim() !== claim) invalid.push("claim not quoted exactly");
    if (!judged.assertions.length) invalid.push("no assertions");
    const inBasis = BASIS_REFS[judged.basis];
    const enforced = judged.assertions.map((assertion, i) => {
      const where = `assertion ${i + 1} (${assertion.kind})`;
      const refs = assertion.evidence.map(normalize);
      const unknown = [...refs, ...assertion.searched.map(normalize)].filter((ref) => /^(Hour|Response|Baseline|Guidance|Note)\b/.test(ref) && !references.has(ref));
      if (unknown.length) invalid.push(`${where}: unknown references ${unknown.join(", ")}`);
      if ((assertion.verdict === "supported" || assertion.verdict === "contradicted") && !refs.length) invalid.push(`${where}: ${assertion.verdict} without evidence references`);
      else if (assertion.verdict === "supported" && !refs.some(inBasis)) invalid.push(`${where}: supported without evidence from its basis`);
      if (assertion.verdict === "unsupported" && (!assertion.searched.length || !assertion.missing.trim())) {
        invalid.push(`${where}: unsupported without what was searched and what is missing`);
      }
      if (assertion.verdict === "contradicted" && (assertion.outside_knowledge || !refs.some(inBasis))) {
        boundaryViolations.push(`${where}: contradicted ${assertion.outside_knowledge ? "on outside knowledge" : "without evidence from its basis"}`);
        return "unsupported" as const;
      }
      return assertion.verdict;
    });
    if (judged.assertions.length && judged.verdict !== derivedVerdict(judged.assertions.map((a) => a.verdict))) {
      invalid.push(`verdict ${judged.verdict} contradicts its assertions (${judged.assertions.map((a) => a.verdict).join(", ")})`);
    }
    return { id, judged, invalid, boundaryViolations, verdict: invalid.length ? undefined : derivedVerdict(enforced) };
  });
  const extra = [...byId.keys()].filter((id) => !batch.cases.some((c) => c.id === id));
  return { claims, extra };
}

export interface NoteCheckResult {
  /** Note lines the judge didn't check. */
  unchecked: string[];
  /** Whether the deliberately corrupted line, if any, was reported inconsistent. */
  corruptionReported?: boolean;
  /** Correct lines reported inconsistent. */
  falseAlarms: string[];
}

export function checkNote(batch: Batch, judgment: Judgment): NoteCheckResult | undefined {
  if (batch.evidence !== "story") return undefined;
  const { noteRefs } = batchPrompt(batch);
  const { corrupted } = noteLines(batch);
  const corruptedRef = corrupted === undefined ? undefined : `Note ${corrupted + 1}`;
  const byLine = new Map(judgment.note_check.map((entry) => [normalize(entry.line), entry]));
  return {
    unchecked: noteRefs.filter((ref) => !byLine.has(ref)),
    corruptionReported: corruptedRef ? byLine.get(corruptedRef)?.consistent === false : undefined,
    falseAlarms: noteRefs.filter((ref) => ref !== corruptedRef && byLine.get(ref)?.consistent === false),
  };
}

/** The answer's allowance per call; with the input it must stay under Groq's 8k tokens a minute. */
export const MAX_OUTPUT_TOKENS = 2400;
/** A conservative estimate: about four characters a token, plus the tool schema. */
export const estimateInputTokens = (prompt: string) => Math.round((prompt.length + JUDGE_INSTRUCTIONS.length) / 4) + 650;

export interface BatchRun {
  batch: string;
  judgment?: Judgment;
  error?: string;
  usage: { inputTokens: number; outputTokens: number };
  ms: number;
  attempts: number;
  providerCalls?: number;
}

/** One judge call for a batch. */
export async function judgeBatch(model: LanguageModel, batch: Batch, maxOutputTokens: number): Promise<BatchRun> {
  const started = Date.now();
  try {
    const result = await generateText({
      model,
      instructions: JUDGE_INSTRUCTIONS,
      messages: [{ role: "user", content: batchPrompt(batch).text }],
      // Unchanged from the first run, so this run measures the method change alone.
      reasoning: "low",
      maxOutputTokens,
      tools: { record_judgment: tool({ description: "Record the note check and a judgment for every claim.", inputSchema: judgmentSchema }) },
      toolChoice: { type: "tool", toolName: "record_judgment" },
    });
    const usage = { inputTokens: result.totalUsage.inputTokens ?? 0, outputTokens: result.totalUsage.outputTokens ?? 0 };
    const call = result.toolCalls.find((toolCall) => toolCall.toolName === "record_judgment");
    if (!call) return { batch: batch.name, error: "no judgment returned", usage, ms: Date.now() - started, attempts: 1 };
    return { batch: batch.name, judgment: call.input as Judgment, usage, ms: Date.now() - started, attempts: 1 };
  } catch (error) {
    // Never pass provider error text through: it can carry account details.
    const name = error instanceof Error ? error.name : "Error";
    return { batch: batch.name, error: `judge call failed (${name})`, usage: { inputTokens: 0, outputTokens: 0 }, ms: Date.now() - started, attempts: 1 };
  }
}
