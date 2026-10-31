/**
 * An eval-only factual-consistency judge (work item G11). It is not used by
 * the server. It sees the claims and the evidence, never the manual labels.
 *
 * EXPERIMENTAL, AND UNSUITABLE FOR SERVER USE. The 2026-10-31 pilot (four
 * two-claim calls on gpt-oss-120b) returned no valid result for any of its
 * eight claims and accepted every defect it judged as supported, so this
 * model-and-contract combination was rejected as a debrief validator and its
 * live runs stopped (docs/testing/eval-2026-10-28.md). It is kept, with its
 * cases and results, as evaluation infrastructure. A test fails if app,
 * server or shared code imports it.
 *
 * The contract, revised twice on 2026-10-31:
 * - Each claim is split into material assertions. Each assertion quotes the
 *   exact span of the claim it covers, and together the quotes must cover
 *   every content word, so a detail like "you kept" can't drop out.
 * - Every piece of evidence is a reference and an exact quotation, which must
 *   occur in the cited line. That catches invented quotations; it can't show
 *   the quotation supports the verdict.
 * - The claim's verdict is derived from its assertions.
 * - "unsupported" names what was searched and what is missing.
 * - Outside knowledge can't make an assertion contradicted.
 * - The derived story-facts note isn't given while judging claims. It is
 *   checked in separate calls, against the log lines its facts refer to,
 *   with offered options labeled apart from what happened.
 * Results that break the contract are invalid, not scored as right or wrong.
 */
import { generateText, tool, type LanguageModel } from "ai";
import { z } from "zod";

import { storyDefects } from "@/lib/debrief-checks";
import alexReplay from "@/lib/fixtures/alex-replay-turns.json";
import { engineBaseline } from "@/lib/inventory";
import { failureSummary, providerErrorDetails } from "@/lib/provider-errors";
import { GUIDANCE } from "@/lib/rules";
import { storyFacts, storyFactsBriefing } from "@/lib/story-facts";
import { TEST_HOUSEHOLDS } from "@/lib/test-households";
import type { TurnOutput } from "@/lib/ttx";

import type { Batch, Household, NoteCheck } from "./cases";
import charlotte from "./fixtures/charlotte.json";
import priya from "./fixtures/priya.json";

export const VERDICTS = ["supported", "contradicted", "unsupported", "unclear"] as const;
export type JudgeVerdict = (typeof VERDICTS)[number];
export const ASSERTION_KINDS = ["actor", "action", "time", "quantity", "provenance", "cause", "state", "other"] as const;

const quotedEvidence = z.array(
  z.object({
    ref: z.string().describe('A line\'s reference, exactly as written in brackets, e.g. "Hour 72 outcome".'),
    quote: z.string().describe("The exact words from that line that bear on the assertion, copied character for character."),
  }),
);

const claimJudgmentSchema = <K extends z.ZodType<string>>(kind: K) =>
  z.object({
    claims: z.array(
      z.object({
        id: z.string(),
        claim: z.string().describe("The claim, quoted exactly as given."),
        basis: z.enum(["story", "household", "guidance"]),
        assertions: z
          .array(
            z.object({
              kind,
              quote: z.string().describe("The exact span of the claim this assertion covers, copied character for character."),
              verdict: z.enum(VERDICTS),
              evidence: quotedEvidence.describe("For supported or contradicted: the lines and exact words that show it."),
              searched: z.array(z.string()).describe("For unsupported: the references or sections you searched. Otherwise empty."),
              missing: z.string().describe("For unsupported: what the evidence would need to say. Otherwise empty."),
              outside_knowledge: z.boolean().describe("True if the verdict relies on anything not in the evidence."),
            }),
          )
          .describe("Every material assertion. Together the quotes must cover every word of the claim that carries meaning."),
        verdict: z.enum(VERDICTS).describe("supported only if every assertion is; contradicted if any is; else unsupported if any is; else unclear."),
        explanation: z.string().describe("At most 25 words."),
      }),
    ),
  });

/** The full contract, checked locally: an assertion's kind must be one of ASSERTION_KINDS. */
export const judgmentSchema = claimJudgmentSchema(z.enum(ASSERTION_KINDS));
/**
 * What the provider is asked for: the same schema with `kind` as free text, since Groq's strict validation
 * rejected a whole call over one kind outside the list (the 10-31 diagnostic's D1). An unknown kind still
 * fails judgmentSchema and validate(), so it makes the result invalid; nothing is normalized.
 */
export const providerJudgmentSchema = claimJudgmentSchema(z.string().describe(`Exactly one of: ${ASSERTION_KINDS.join(", ")}.`));
export type Judgment = z.infer<typeof judgmentSchema>;
/** A judgment as the provider may return it, before the kinds are checked. */
export type ProviderJudgment = z.infer<typeof providerJudgmentSchema>;
export type JudgedClaim = ProviderJudgment["claims"][number];
export type JudgedAssertion = JudgedClaim["assertions"][number];

export const noteJudgmentSchema = z.object({
  lines: z.array(
    z.object({
      line: z.string().describe('The note line\'s reference, e.g. "Note 2".'),
      verdict: z.enum(["consistent", "inconsistent", "unverifiable"]),
      conflicting_detail: z.string().describe("For inconsistent: the exact words of the note line that conflict with the log. Otherwise empty."),
      evidence: quotedEvidence.describe("The log lines and exact words that show it."),
      explanation: z.string().describe("At most 25 words."),
    }),
  ),
});
export type NoteJudgment = z.infer<typeof noteJudgmentSchema>;

export const JUDGE_INSTRUCTIONS = `You check claims from the debrief of a household emergency exercise against the evidence given, and nothing else.

For each claim:
1. Split it into its material assertions: who acted (actor), what was done (action), when (time), how much or how long (quantity), whose equipment it was or where it came from (provenance), what caused what (cause), and what was the case (state).
2. For each assertion, quote the exact span of the claim it covers, character for character. Together your quotes must cover every word of the claim that carries meaning; don't paraphrase a detail away.
3. Judge each assertion:
   - supported: the evidence states it, or it follows directly.
   - contradicted: the evidence states something incompatible with it.
   - unsupported: the evidence neither states nor implies it, and doesn't contradict it. List what you searched and what is missing.
   - unclear: too vague or evaluative to check, or the evidence conflicts with itself.
   For supported or contradicted, give each piece of evidence as the line's reference in brackets and the exact words from that line, copied character for character.
4. The claim's verdict follows from its assertions: supported only if every assertion is supported; contradicted if any is contradicted; otherwise unsupported if any is unsupported; otherwise unclear.

Rules:
- Each claim has one basis: story (the exercise log), household (the baseline) or guidance (the approved guidance). The story can't establish a guidance fact, and guidance can't establish what happened.
- Use only the evidence given. Knowledge from outside it can't make an assertion contradicted or supported; if you notice such knowledge, the assertion is unsupported, and set outside_knowledge.
- A forecast ("will be restored in about six hours", "could run out within two hours") is not an event. Never treat a forecast as having happened.
- The participant's actions are only what their responses say. Story events and other people's actions are not the participant's.
- Missing evidence is unknown. Some hours' outcomes are omitted, and the log doesn't record everything: the absence of a line never shows that something didn't happen, so it can't make an assertion contradicted.
- Quote each claim exactly.`;

export const NOTE_INSTRUCTIONS = `You check a note that software derived from the log of a household emergency exercise. Check every note line against the log lines given, and nothing else.

For each note line, give one verdict:
- consistent: the log lines say what the note line says.
- inconsistent: the log lines say something incompatible with it. Quote the exact words of the note line that conflict.
- unverifiable: the log lines given neither confirm nor contradict it.

Give evidence as the log line's reference in brackets and the exact words from that line, copied character for character. An offered option is a choice the participant was given, not something that happened. A forecast is not an event.`;

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

/** A household's baseline lines, labeled for citing; person and pet sub-lines stay under their line. */
const baselineLines = (baseline: string) =>
  baseline
    .split("\n")
    .filter(Boolean)
    .map((line) => (line.startsWith("- ") ? `  ${line}` : `[Baseline: ${line.split(":")[0]}] ${line}`));

/** The approved guidance, numbered for citing. */
export const guidanceLines = () =>
  GUIDANCE.map((guidance) => guidance.brief)
    .filter(Boolean)
    .map((brief, i) => `[Guidance ${i + 1}] ${brief}`);

/** A turn's situation without its offered choices, which are options, not events. */
const withoutChoices = (text: string) =>
  text.replace(/\s*(You (must|need to|have to) (now )?(decide|choose)|Decide whether|Choose whether|They suggest three options|Options include)[\s\S]*$/, "").trim();

interface LogOptions {
  omitHours?: number[];
  /** Only these hours (for note checks). */
  onlyHours?: number[];
  responses?: boolean;
  /** Offered options, labeled as options. */
  options?: boolean;
}

function logLines({ turns, responses }: HouseholdEvidence, { omitHours = [], onlyHours, responses: withResponses = true, options = false }: LogOptions) {
  return turns.flatMap((turn, i) => {
    const hour = turn.hours_elapsed;
    if (onlyHours && !onlyHours.includes(hour)) return [];
    const omitted = omitHours.includes(hour);
    const situation = omitted ? "" : withoutChoices(turn.new_inject ?? "");
    return [
      turn.narrative_response && !omitted ? `[Hour ${hour} outcome] ${turn.narrative_response}` : "",
      situation ? `[Hour ${hour} situation] ${situation}` : "",
      ...(options ? turn.response_options.map((option, n) => `[Hour ${hour} offered option ${n + 1}] ${option}`) : []),
      turn.critical_alerts.length ? `[Hour ${hour} alerts] ${turn.critical_alerts.join(" ")}` : "",
      withResponses && responses[i] ? `[Response after Hour ${hour}] ${responses[i]}` : "",
    ].filter(Boolean);
  });
}

/** Every bracketed reference in a prompt, with the text of its line. */
export const referencedLines = (text: string) =>
  new Map([...text.matchAll(/^\s*\[([^\]]+)\] (.*)$/gm)].map((match) => [match[1], match[2]]));

/** The judge's message for a claim batch, and every line it may cite. */
export function batchPrompt(batch: Batch): { text: string; lines: Map<string, string> } {
  const evidence = EVIDENCE[batch.household]();
  const sections: string[] = [];
  if (batch.evidence === "story") {
    // Story claims get the household facts the log refers to, without the inventory gaps, to stay under the token limit.
    sections.push(`HOUSEHOLD BASELINE:\n${baselineLines(evidence.baseline).filter((line) => !line.startsWith("[Baseline: Gaps")).join("\n")}`);
    const omitted = batch.omitHours ?? [];
    sections.push(
      `EXERCISE LOG ("Response after Hour N" is the participant's own message; the next hour's outcome follows from it.${omitted.length ? ` Outcomes and situations for Hours ${omitted.join(", ")} are omitted for length; every response and alert is included.` : ""}):\n${logLines(evidence, { omitHours: omitted }).join("\n")}`,
    );
  } else {
    sections.push(`HOUSEHOLD BASELINE:\n${baselineLines(evidence.baseline).join("\n")}`, `APPROVED GUIDANCE:\n${guidanceLines().join("\n")}`);
  }
  const claims = batch.cases.map(({ id, claim }) => `${id}: ${claim}`).join("\n");
  const text = `${sections.join("\n\n")}\n\nCLAIMS (judge each; quote it exactly):\n${claims}`;
  return { text, lines: referencedLines(text) };
}

/** The note's factual lines: its headers and instructions aren't facts, and the logged hours are checked offline. */
const isFact = (line: string) => !line.endsWith(":") && !line.startsWith("Logged hours:") && !line.startsWith("The participant's actions");

/** The story-facts note's factual lines, with the planted false line. */
export function noteLines(check: NoteCheck): { lines: string[]; corrupted: number } {
  const evidence = EVIDENCE[check.household]();
  const note = storyFactsBriefing(storyFacts(evidence.turns, storyDefects(evidence.turns, { baseline: evidence.baseline, participantText: evidence.responses })));
  let lines = note
    .split("\n")
    .slice(1)
    .map((line) => line.trim().replace(/^- /, ""))
    .filter(isFact);
  const { find, replace, add } = check.corrupt;
  let corrupted: number;
  if (find && replace) {
    corrupted = lines.findIndex((line) => line.includes(find));
    if (corrupted < 0) throw new Error(`${check.name}: the note has no line with "${find}"`);
    lines = lines.map((line, i) => (i === corrupted ? line.replace(find, replace) : line));
  } else {
    // In the middle, so it isn't the obvious odd one out at either end.
    corrupted = Math.floor(lines.length / 2);
    lines = [...lines.slice(0, corrupted), add!, ...lines.slice(corrupted)];
  }
  return { lines, corrupted };
}

const hoursIn = (text: string) => [...text.matchAll(/\bHour (\d+)\b/g)].map((match) => Number(match[1]));

/**
 * The note-check message: the hours the note's lines name, and the refuting hours for the planted line, with their
 * outcomes, situations, offered options and alerts.
 */
export function notePrompt(check: NoteCheck): { text: string; lines: Map<string, string>; noteRefs: string[]; corruptedRef: string } {
  const evidence = EVIDENCE[check.household]();
  const { lines, corrupted } = noteLines(check);
  const hours = [...new Set([...lines.flatMap(hoursIn), ...check.corrupt.refutedBy.flatMap(hoursIn)])].sort((a, b) => a - b);
  const log = logLines(evidence, { onlyHours: hours, responses: false, options: true });
  const note = lines.map((line, i) => `[Note ${i + 1}] ${line}`);
  const text = `LOG LINES (Hours ${hours.join(", ")}; "offered option" lines are choices the participant was given, not events):\n${log.join("\n")}\n\nNOTE:\n${note.join("\n")}`;
  return { text, lines: referencedLines(text), noteRefs: note.map((_, i) => `Note ${i + 1}`), corruptedRef: `Note ${corrupted + 1}` };
}

/** Note lines whose hours or quotations aren't in the note-check's evidence, other than the planted line. */
export function untraceableNoteLines(check: NoteCheck): string[] {
  const { text, lines, corruptedRef } = notePrompt(check);
  const log = [...lines].filter(([ref]) => !ref.startsWith("Note ")).map(([, line]) => normalizeText(line));
  return [...lines]
    .filter(([ref]) => ref.startsWith("Note ") && ref !== corruptedRef)
    .filter(([, line]) => {
      // Quotations from the log follow a colon; other quoted words are the note's instructions.
      const quotes = [...line.matchAll(/: "([^"]+?)…?"/g)].map((match) => normalizeText(match[1].replace(/…$/, "")));
      const hoursPresent = hoursIn(line).every((hour) => text.includes(`[Hour ${hour} `));
      return !hoursPresent || !quotes.every((quote) => log.some((logLine) => logLine.includes(quote)));
    })
    .map(([ref, line]) => `${ref}: ${line}`);
}

/** Text compared for quotations: typographic variants and spacing made uniform. */
export const normalizeText = (text: string) =>
  text
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[    ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:…]+$/, "");

const normalizeRef = (ref: string) => ref.trim().replace(/^\[|\]$/g, "");

/** Whether a quoted piece of evidence occurs in the line it cites. */
const quoteProblem = (lines: Map<string, string>, { ref, quote }: { ref: string; quote: string }): string | undefined => {
  const line = lines.get(normalizeRef(ref));
  if (line === undefined) return `unknown reference ${ref}`;
  if (!normalizeText(quote)) return `no quotation from ${ref}`;
  if (!normalizeText(line).includes(normalizeText(quote))) return `quotation not in ${ref}: "${quote.slice(0, 60)}"`;
  return undefined;
};

/** Words that carry no detail of their own, left out of the coverage check. */
const FILLER = new Set("a an the of to and or at in on for with by from as is was were be been that which it its this these those".split(" "));
const contentWords = (text: string) => (normalizeText(text).toLowerCase().match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) ?? []).filter((word) => !FILLER.has(word));

/** The claim's content words no assertion quotes. */
export function uncoveredWords(claim: string, quotes: string[]): string[] {
  const covered = new Set(quotes.flatMap(contentWords));
  return [...new Set(contentWords(claim).filter((word) => !covered.has(word)))];
}

/** References that count as evidence for a basis. */
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

/** Checks a claim batch's judgment against the contract, claim by claim. */
export const validate = (batch: Batch, judgment: ProviderJudgment) => validateClaims(batchPrompt(batch).lines, batch.cases, judgment);

/** Checks a judgment against the contract, given the lines it may cite and the claims it was given. */
export function validateClaims(
  lines: Map<string, string>,
  cases: { id: string; claim: string }[],
  judgment: ProviderJudgment,
): { claims: ValidatedClaim[]; extra: string[] } {
  const byId = new Map(judgment.claims.map((claim) => [claim.id, claim]));
  const claims = cases.map(({ id, claim }): ValidatedClaim => {
    const judged = byId.get(id);
    if (!judged) return { id, invalid: ["no verdict for this claim"], boundaryViolations: [] };
    const invalid: string[] = [];
    const boundaryViolations: string[] = [];
    if (normalizeText(judged.claim) !== normalizeText(claim)) invalid.push("claim not quoted exactly");
    if (!judged.assertions.length) invalid.push("no assertions");
    for (const [i, assertion] of judged.assertions.entries()) {
      if (!normalizeText(claim).includes(normalizeText(assertion.quote)) || !normalizeText(assertion.quote)) {
        invalid.push(`assertion ${i + 1}: its quote isn't a span of the claim ("${assertion.quote.slice(0, 50)}")`);
      }
    }
    const uncovered = uncoveredWords(claim, judged.assertions.map((a) => a.quote));
    if (judged.assertions.length && uncovered.length) invalid.push(`claim words no assertion quotes: ${uncovered.join(", ")}`);

    const inBasis = BASIS_REFS[judged.basis];
    const enforced = judged.assertions.map((assertion, i) => {
      const where = `assertion ${i + 1} (${assertion.kind.slice(0, 30)})`;
      if (!(ASSERTION_KINDS as readonly string[]).includes(assertion.kind)) invalid.push(`${where}: unknown kind`);
      for (const problem of assertion.evidence.map((e) => quoteProblem(lines, e)).filter(Boolean)) invalid.push(`${where}: ${problem}`);
      const unknownSearched = assertion.searched.map(normalizeRef).filter((ref) => /^(Hour|Response|Baseline|Guidance)\b/.test(ref) && !lines.has(ref));
      if (unknownSearched.length) invalid.push(`${where}: searched unknown references ${unknownSearched.join(", ")}`);
      const refs = assertion.evidence.map((e) => normalizeRef(e.ref));
      if ((assertion.verdict === "supported" || assertion.verdict === "contradicted") && !refs.length) invalid.push(`${where}: ${assertion.verdict} without evidence`);
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
  const extra = [...byId.keys()].filter((id) => !cases.some((c) => c.id === id));
  return { claims, extra };
}

export interface NoteCheckResult {
  /** Note lines the judge didn't check. */
  unchecked: string[];
  /** Contract breaks: invented quotations, unknown references. */
  invalid: string[];
  /** The planted line: marked inconsistent, on the planted detail, with a correct quotation from a refuting line. */
  planted: { detected: boolean; markedInconsistent: boolean; onDetail: boolean; refutedCorrectly: boolean };
  /** Correct lines marked inconsistent. */
  falseAlarms: string[];
}

export function checkNote(check: NoteCheck, judgment: NoteJudgment): NoteCheckResult {
  const { lines, noteRefs, corruptedRef } = notePrompt(check);
  const byLine = new Map(judgment.lines.map((entry) => [normalizeRef(entry.line), entry]));
  const invalid = judgment.lines.flatMap((entry) =>
    entry.evidence.map((e) => quoteProblem(lines, e)).filter((p): p is string => Boolean(p)).map((p) => `${entry.line}: ${p}`),
  );
  const planted = byLine.get(corruptedRef);
  const markedInconsistent = planted?.verdict === "inconsistent";
  const onDetail = Boolean(planted && normalizeText(planted.conflicting_detail).includes(normalizeText(check.corrupt.detail)));
  const refutedCorrectly = Boolean(
    planted?.evidence.some((e) => check.corrupt.refutedBy.includes(normalizeRef(e.ref)) && !quoteProblem(lines, e)),
  );
  return {
    unchecked: noteRefs.filter((ref) => !byLine.has(ref)),
    invalid,
    planted: { detected: markedInconsistent && onDetail && refutedCorrectly, markedInconsistent, onDetail, refutedCorrectly },
    falseAlarms: noteRefs.filter((ref) => ref !== corruptedRef && byLine.get(ref)?.verdict === "inconsistent"),
  };
}

/** The answer's allowance per claim call; with the input it must stay under Groq's 8k tokens a minute. */
export const MAX_OUTPUT_TOKENS = 2400;
/** The answer's allowance per note-check call. */
export const NOTE_MAX_OUTPUT_TOKENS = 1500;
/** A conservative estimate: about four characters a token, plus the tool schema. */
export const estimateInputTokens = (prompt: string, instructions = JUDGE_INSTRUCTIONS) => Math.round((prompt.length + instructions.length) / 4) + 700;

export type CallStatus = "completed" | "provider failure" | "no tool call" | "not run";

export interface CallRun<T> {
  name: string;
  status: CallStatus;
  result?: T;
  /** Status and kind only (failureSummary): never the provider's text. */
  error?: string;
  /** The provider's error code, e.g. "tool_use_failed", when it gives one. */
  errorCode?: string;
  /** For a malformed tool call: the rejected generation's size and shape, never its content. */
  failedGeneration?: { length: number; json: boolean; schemaIssues: string[]; parseError?: JsonBreak };
  finishReason?: string;
  /** Whether a returned tool call's arguments pass the full schema locally (kinds included), and the paths that don't. */
  schemaValid?: boolean;
  schemaIssues?: string[];
  usage: { inputTokens: number; outputTokens: number };
  ms: number;
  attempts: number;
  providerCalls?: number;
}

const issuePaths = (error: z.ZodError) => [...new Set(error.issues.map((issue) => issue.path.join(".") || "(root)"))].slice(0, 12);

/**
 * Where and how text stops being JSON, without any of the text: clues to truncation, not proof of it. Output
 * that ends inside a string or with structures still open looks cut off; a break well before the end doesn't.
 */
export interface JsonBreak {
  /** Which text failed: the generation itself, or the arguments string inside a {name, arguments} call. */
  layer: "generation" | "arguments";
  /** That text's length in characters. */
  length: number;
  /** The parser's error position (the length, for unexpected end of input); undefined if it gave none. */
  position?: number;
  /** Whether the text ends inside a string. */
  endsInString: boolean;
  /** Objects and arrays still open at the end. */
  unclosed: number;
}

export function jsonBreak(text: string, layer: JsonBreak["layer"] = "generation"): JsonBreak | undefined {
  let message: string;
  try {
    JSON.parse(text);
    return undefined;
  } catch (error) {
    message = error instanceof Error ? error.message : "";
  }
  // Only the number is read from the parser's message, which can quote the text.
  const at = message.match(/at position (\d+)/);
  const position = at ? Number(at[1]) : /unexpected end of json input/i.test(message) ? text.length : undefined;
  let inString = false;
  let escaped = false;
  let depth = 0;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth++;
    else if ((char === "}" || char === "]") && depth > 0) depth--;
  }
  return { layer, length: text.length, position, endsInString: inString, unclosed: depth };
}

/** The shape of a generation the provider rejected, without keeping any of it. */
export function describeFailedGeneration(generation: string | undefined, schema: z.ZodType): CallRun<unknown>["failedGeneration"] {
  if (generation === undefined) return undefined;
  const outer = jsonBreak(generation);
  if (outer) return { length: generation.length, json: false, schemaIssues: [], parseError: outer };
  const parsed: unknown = JSON.parse(generation);
  // Groq returns either the arguments or a {name, arguments} call.
  let args = parsed && typeof parsed === "object" && "arguments" in parsed ? (parsed as { arguments: unknown }).arguments : parsed;
  if (typeof args === "string") {
    const inner = jsonBreak(args, "arguments");
    if (inner) return { length: generation.length, json: false, schemaIssues: [], parseError: inner };
    args = JSON.parse(args);
  }
  const checked = schema.safeParse(args);
  return { length: generation.length, json: true, schemaIssues: checked.success ? [] : issuePaths(checked.error) };
}

async function call<T>(
  model: LanguageModel,
  name: string,
  instructions: string,
  content: string,
  /** What the provider is asked for and enforces. */
  schema: z.ZodType<T>,
  maxOutputTokens: number,
  /** 0 turns off the SDK's own retries (rate limits, server errors), for the diagnostic. */
  maxRetries?: number,
  /** The full schema checked locally, when the provider's is looser. */
  localSchema: z.ZodType = schema,
): Promise<CallRun<T>> {
  const started = Date.now();
  try {
    const result = await generateText({
      model,
      instructions,
      messages: [{ role: "user", content }],
      // Unchanged from the first run, so a run measures the method change alone.
      reasoning: "low",
      maxOutputTokens,
      ...(maxRetries === undefined ? {} : { maxRetries }),
      tools: { record: tool({ description: "Record your judgment.", inputSchema: schema }) },
      toolChoice: { type: "tool", toolName: "record" },
    });
    const usage = { inputTokens: result.totalUsage.inputTokens ?? 0, outputTokens: result.totalUsage.outputTokens ?? 0 };
    const finishReason = String(result.finishReason);
    const recorded = result.toolCalls.find((toolCall) => toolCall.toolName === "record");
    if (!recorded) return { name, status: "no tool call", finishReason, usage, ms: Date.now() - started, attempts: 1 };
    const checked = localSchema.safeParse(recorded.input);
    return {
      name,
      status: "completed",
      result: recorded.input as T,
      finishReason,
      schemaValid: checked.success,
      schemaIssues: checked.success ? [] : issuePaths(checked.error),
      usage,
      ms: Date.now() - started,
      attempts: 1,
    };
  } catch (error) {
    // Only the status, kind and error code: provider error text can carry account details.
    const { code, failedGeneration } = providerErrorDetails(error);
    return {
      name,
      status: "provider failure",
      error: failureSummary(error),
      errorCode: code,
      failedGeneration: describeFailedGeneration(failedGeneration, schema),
      usage: { inputTokens: 0, outputTokens: 0 },
      ms: Date.now() - started,
      attempts: 1,
    };
  }
}

/** The synthetic diagnostic's claim call: the same instructions, schema and reasoning as a real claim call, and its allowance unless a diagnostic raises it. */
export const judgeClaimsText = (model: LanguageModel, name: string, content: string, maxRetries?: number, maxOutputTokens = MAX_OUTPUT_TOKENS) =>
  call<ProviderJudgment>(model, name, JUDGE_INSTRUCTIONS, content, providerJudgmentSchema, maxOutputTokens, maxRetries, judgmentSchema);

export const judgeBatch = (model: LanguageModel, batch: Batch, maxRetries?: number) =>
  call<ProviderJudgment>(model, batch.name, JUDGE_INSTRUCTIONS, batchPrompt(batch).text, providerJudgmentSchema, MAX_OUTPUT_TOKENS, maxRetries, judgmentSchema);

export const judgeNote = (model: LanguageModel, check: NoteCheck, maxRetries?: number) =>
  call<NoteJudgment>(model, check.name, NOTE_INSTRUCTIONS, notePrompt(check).text, noteJudgmentSchema, NOTE_MAX_OUTPUT_TOKENS, maxRetries);
