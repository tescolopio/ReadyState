/**
 * An eval-only factual-consistency judge (work item G11). It is not used by
 * the server. It sees the claims and the evidence, never the manual labels.
 *
 * Evidence comes in labeled lines so the judge can cite them. The story-facts
 * note is included as derived evidence that may be wrong: the judge is told to
 * judge by the log and report any conflict.
 */
import { generateText, tool, type LanguageModel } from "ai";
import { z } from "zod";

import { storyDefects } from "@/lib/debrief-checks";
import replay from "@/lib/fixtures/alex-replay-turns.json";
import { engineBaseline } from "@/lib/inventory";
import { storyFacts, storyFactsBriefing } from "@/lib/story-facts";
import { TEST_HOUSEHOLDS } from "@/lib/test-households";
import type { TurnOutput } from "@/lib/ttx";

import type { Batch } from "./cases";

export const VERDICTS = ["supported", "contradicted", "unsupported", "unclear"] as const;

export const judgmentSchema = z.object({
  story_facts_conflicts: z
    .array(z.object({ note_text: z.string(), log_references: z.array(z.string()), explanation: z.string() }))
    .describe("Each place the STORY FACTS note conflicts with the log. Empty if none, or if no note was given."),
  verdicts: z.array(
    z.object({
      id: z.string(),
      claim: z.string().describe("The claim, quoted exactly as given."),
      basis: z.enum(["story", "household", "guidance"]),
      verdict: z.enum(VERDICTS),
      involves_forecast: z.boolean().describe("True if judging the claim depends on a forecast in the evidence."),
      evidence: z.array(z.string()).describe('References of the evidence lines used, as written in brackets, e.g. "Hour 72 outcome".'),
      explanation: z.string().describe("At most 40 words."),
    }),
  ),
});
export type Judgment = z.infer<typeof judgmentSchema>;

export const JUDGE_INSTRUCTIONS = `You check claims from the debrief of a household emergency exercise against the evidence given. Judge each claim on its own.

Verdicts:
- supported: the evidence states it, or it follows directly.
- contradicted: the evidence states something incompatible with it.
- unsupported: the evidence neither states nor implies it, and doesn't contradict it; for example an action nobody describes, or a conclusion the events don't establish.
- unclear: the claim is too vague or evaluative to check, or the evidence is genuinely ambiguous.

Rules:
1. Each claim has one basis: story (what happened in the exercise log), household (the baseline), or guidance (the approved guidance). The story can't establish a guidance fact, and guidance can't establish what happened. If the evidence for a claim's basis isn't given, the claim is unsupported.
2. A forecast ("will be restored in about six hours") is not an event. Set involves_forecast when judging a claim depends on one, and never treat a forecast as having happened.
3. The participant's actions are only what their responses say. Story events and other people's actions are not the participant's.
4. STORY FACTS is derived from the log by software and may be wrong. The log is the source. Report every conflict between the note and the log in story_facts_conflicts, and judge by the log.
5. Quote each claim exactly. Cite evidence by the references in brackets. Explain in at most 40 words.`;

/** The household baseline and the approved guidance as labeled lines, from the eval's Alex. */
function baselineLines() {
  const baseline = engineBaseline(TEST_HOUSEHOLDS.find((household) => household.id === "alex")!.profile);
  const [household, guidance = ""] = baseline.split(/\nOfficial guidance[^\n]*\n/);
  return {
    baseline,
    household: household
      .split("\n")
      .filter(Boolean)
      .map((line) => `[Baseline: ${line.split(":")[0]}] ${line}`),
    guidance: guidance
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2))
      .map((line) => `[Guidance: ${line.split(":")[0]}] ${line}`),
  };
}

/** A turn's situation without its offered choices, which are options, not events. */
const withoutChoices = (text: string) => text.replace(/\s*(You (must|need to|have to) (now )?(decide|choose)|Decide whether|Choose whether)[\s\S]*$/, "").trim();

/**
 * Story outcomes and situations for these hours are left out for length, to keep each call under the provider's
 * per-minute token limit; no story claim in the case set depends on them. Every response and alert stays in.
 */
export const OMITTED_HOURS = [6, 12, 18, 24];

function logLines(turns: TurnOutput[], responses: string[]) {
  return turns.flatMap((turn, i) => {
    const hour = turn.hours_elapsed;
    const omitted = OMITTED_HOURS.includes(hour);
    const situation = omitted ? "" : withoutChoices(turn.new_inject ?? "");
    return [
      turn.narrative_response && !omitted ? `[Hour ${hour} outcome] ${turn.narrative_response}` : "",
      situation ? `[Hour ${hour} situation] ${situation}` : "",
      turn.critical_alerts.length ? `[Hour ${hour} alerts] ${turn.critical_alerts.join(" ")}` : "",
      responses[i] ? `[Response after Hour ${hour}] ${responses[i]}` : "",
    ].filter(Boolean);
  });
}

/** A deliberate conflict with the log: power returning at Hour 54 instead of Hour 60. */
export const corrupt = (note: string) =>
  note.replace("Power returned at Hour 60", "Power returned at Hour 54").replace("from Hour 60, when power returned", "from Hour 54, when power returned");

/** The judge's message for a batch: evidence sections, then the claims. */
export function batchPrompt(batch: Batch): string {
  const turns = replay.turns as TurnOutput[];
  const { baseline, household, guidance } = baselineLines();
  // Story claims get the log and the household facts it refers to; guidance stays with the guidance batch, and the
  // inventory gaps are left out of story batches to keep each call under the provider's per-minute token limit.
  const sections =
    batch.evidence === "story"
      ? [`HOUSEHOLD BASELINE:\n${household.filter((line) => !line.startsWith("[Baseline: Gaps")).join("\n")}`]
      : [`HOUSEHOLD BASELINE:\n${household.join("\n")}`, `APPROVED GUIDANCE:\n${guidance.join("\n")}`];
  if (batch.evidence === "story") {
    const facts = storyFactsBriefing(storyFacts(turns, storyDefects(turns, { baseline, participantText: replay.responses })));
    sections.push(
      `EXERCISE LOG ("Response after Hour N" is the participant's own message; the next hour's outcome follows from it. Outcomes and situations for Hours ${OMITTED_HOURS.join(", ")}, the flood rising, are omitted for length; every response and alert is included):\n${logLines(turns, replay.responses).join("\n")}`,
      `${batch.corruptStoryFacts ? corrupt(facts) : facts}`,
    );
  }
  const claims = batch.cases.map(({ id, claim }) => `${id}: ${claim}`).join("\n");
  return `${sections.join("\n\n")}\n\nCLAIMS (judge each; quote it exactly):\n${claims}`;
}

/** Problems with a judgment's form, not its verdicts: missing or extra ids, inexact quotes, missing evidence. */
export function formProblems(batch: Batch, judgment: Judgment): string[] {
  const problems: string[] = [];
  const byId = new Map(judgment.verdicts.map((verdict) => [verdict.id, verdict]));
  for (const { id, claim } of batch.cases) {
    const verdict = byId.get(id);
    if (!verdict) problems.push(`${id}: no verdict`);
    else {
      if (verdict.claim.trim() !== claim) problems.push(`${id}: claim not quoted exactly`);
      if (!verdict.evidence.length && verdict.verdict !== "unclear") problems.push(`${id}: no evidence references`);
      if (verdict.explanation.split(/\s+/).length > 50) problems.push(`${id}: explanation over 40 words`);
    }
  }
  for (const id of byId.keys()) if (!batch.cases.some((c) => c.id === id)) problems.push(`${id}: not in the batch`);
  return problems;
}

/** The answer's allowance per call; with the input it must stay under Groq's 8k tokens a minute. */
export const MAX_OUTPUT_TOKENS = 2400;
/** A conservative estimate: about four characters a token, plus the tool schema. */
export const estimateInputTokens = (prompt: string) => Math.round((prompt.length + JUDGE_INSTRUCTIONS.length) / 4) + 450;

export interface BatchRun {
  batch: string;
  judgment?: Judgment;
  error?: string;
  usage: { inputTokens: number; outputTokens: number };
  ms: number;
  attempts: number;
}

/** One judge call for a batch. Rate-limit retries happen inside the SDK and are counted by the caller's wrapper. */
export async function judgeBatch(model: LanguageModel, batch: Batch, maxOutputTokens: number): Promise<BatchRun> {
  const started = Date.now();
  try {
    const result = await generateText({
      model,
      instructions: JUDGE_INSTRUCTIONS,
      messages: [{ role: "user", content: batchPrompt(batch) }],
      reasoning: "low",
      maxOutputTokens,
      tools: { record_verdicts: tool({ description: "Record a verdict for every claim.", inputSchema: judgmentSchema }) },
      toolChoice: { type: "tool", toolName: "record_verdicts" },
    });
    const usage = { inputTokens: result.totalUsage.inputTokens ?? 0, outputTokens: result.totalUsage.outputTokens ?? 0 };
    const call = result.toolCalls.find((toolCall) => toolCall.toolName === "record_verdicts");
    if (!call) return { batch: batch.name, error: "no verdicts returned", usage, ms: Date.now() - started, attempts: 1 };
    return { batch: batch.name, judgment: call.input as Judgment, usage, ms: Date.now() - started, attempts: 1 };
  } catch (error) {
    // Never pass provider error text through: it can carry account details.
    const name = error instanceof Error ? error.name : "Error";
    return { batch: batch.name, error: `judge call failed (${name})`, usage: { inputTokens: 0, outputTokens: 0 }, ms: Date.now() - started, attempts: 1 };
  }
}
