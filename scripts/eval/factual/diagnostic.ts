/**
 * A provider diagnostic for the G11 claim call (authorized 2026-10-31,
 * 16,000-token cap, no retries). It measures call completion, not factual
 * accuracy: three calls with synthetic content, the claim call's own
 * instructions, schema, reasoning and output allowance, each varying one
 * factor. The content is invented and shares nothing with the case set.
 */
import { MAX_OUTPUT_TOKENS, estimateInputTokens, referencedLines, validateClaims, type CallRun, type ProviderJudgment } from "./judge";

const BASELINE = [
  "HOUSEHOLD BASELINE:",
  "[Baseline: People] People: 2 adults, 1 cat.",
  "[Baseline: Home] Home: single-story house, gas furnace with electric blower, electric stove. Backup power: none.",
  "[Baseline: Stored] Stored: 6 gallons of stored water, 5 days of food.",
  "[Baseline: Has] Has: flashlights, battery radio, first aid kit, wool blankets.",
].join("\n");

/** An invented ice storm, hour by hour. */
const HOURS: [number, string, string, string][] = [
  [0, "Freezing rain coats the street and the trees by evening.", "The radio warns of widespread outages overnight.", "We fill the bathtub, charge our phones and bring the cat's carrier inside."],
  [6, "A transformer pops two blocks away and the power goes out.", "The furnace's blower stops, so the furnace can't heat the house.", "We close off the back bedrooms and gather in the living room with the wool blankets."],
  [12, "The house cools to 58 °F by morning.", "A neighbor says the utility expects repairs to take at least two days.", "We eat cold cereal, keep the fridge closed and listen to the radio for updates."],
  [18, "Branches heavy with ice fall across the driveway.", "The car is blocked in until the branches are cleared.", "I clear the smaller branches with a hand saw and leave the large limb for the city."],
  [24, "Indoor temperature reaches 52 °F.", "The radio announces a warming center at the high school, three miles away.", "We stay home for now and add layers, hats and a second blanket each."],
  [30, "The cat hides under the bed and won't eat.", "Water pressure drops but the taps still run.", "We set out water and food for the cat near the bed and use the tub water for flushing."],
];

/** Plain filler that keeps the story going without new facts, for padding D2 to a real call's size. */
const FILLER = [
  "The wind keeps rattling the windows, and ice keeps building on the power lines along the street.",
  "Neighbors check on each other by shouting across yards, since phone batteries are being saved.",
  "The radio repeats the same advice about staying off the roads and checking on older neighbors.",
  "Light through the frosted windows is dim, so the flashlights stay within reach all day.",
];

function log(hours: typeof HOURS, padding = 0) {
  return hours
    .flatMap(([hour, outcome, situation, response], i) => [
      `[Hour ${hour} outcome] ${outcome}${padding ? ` ${Array.from({ length: padding }, (_, n) => FILLER[(i + n) % FILLER.length]).join(" ")}` : ""}`,
      `[Hour ${hour} situation] ${situation}`,
      `[Response after Hour ${hour}] ${response}`,
    ])
    .join("\n");
}

/** Later hours for padding: the same storm continuing, with no new facts the claims depend on. */
const LATER: typeof HOURS = [36, 42, 48, 54, 60, 66].map((hour) => [hour, "The outage continues and the ice holds.", "The radio has no new repair estimate.", "We keep to the living room and ration flashlight use."]);

const claims = (list: string[]) => `CLAIMS (judge each; quote it exactly):\n${list.map((claim, i) => `D${String(i + 1).padStart(2, "0")}: ${claim}`).join("\n")}`;

const TWO_CLAIMS = [
  "The furnace stopped heating when the power went out at Hour 6.",
  "You drove the household to the warming center at Hour 24.",
];

const FIVE_CLAIMS = [
  "At Hour 0 you filled the bathtub, charged your phones and brought the cat's carrier inside after the radio warned of outages.",
  "When the transformer failed at Hour 6, the furnace's blower stopped, and you closed off the back bedrooms to gather in the living room with wool blankets.",
  "By Hour 12 the house had cooled to 58 °F, and a neighbor said the utility expected repairs to take at least two days.",
  "At Hour 18 you cut the large fallen limb with a hand saw so the car could leave the driveway.",
  "At Hour 30 the water pressure dropped and the taps stopped running, so you used the tub water for drinking.",
];

export interface DiagnosticCall {
  name: string;
  varies: string;
  content: string;
  allowance: number;
}

const section = (text: string) => `${BASELINE}\n\nEXERCISE LOG ("Response after Hour N" is the participant's own message; the next hour's outcome follows from it):\n${text}`;

export function diagnosticCalls(): DiagnosticCall[] {
  const make = (name: string, varies: string, content: string) => ({ name, varies, content, allowance: estimateInputTokens(content) + MAX_OUTPUT_TOKENS });
  return [
    make("D1", "baseline: the claim schema, a short synthetic log, 2 claims", `${section(log(HOURS.slice(0, 4)))}\n\n${claims(TWO_CLAIMS)}`),
    make("D2", "input size: the synthetic log padded to a real story call's size, 2 claims", `${section(log([...HOURS, ...LATER], 10))}\n\n${claims(TWO_CLAIMS)}`),
    make("D3", "output length: a short synthetic log, 5 detail-rich claims", `${section(log(HOURS))}\n\n${claims(FIVE_CLAIMS)}`),
  ];
}

/** The first diagnostic's cap on input and output tokens (D1–D3, 10-31), charging a failed call at its full allowance. */
export const DIAGNOSTIC_CAP = 16_000;

/**
 * The second diagnostic (authorized 10-31): D1 and D3 again with `kind` as free text in the provider's schema,
 * everything else unchanged, under a 10,000-token cap. It tests whether that one change helps completion.
 */
export const RELAXED_KIND_RUN = { calls: ["D1", "D3"], cap: 10_000 };

/** The charge for a call: its full allowance unless the provider reported its usage. */
export const chargeFor = (run: CallRun<unknown>, allowance: number) => {
  const reported = run.usage.inputTokens + run.usage.outputTokens;
  return run.status === "provider failure" || !run.usage.inputTokens || !run.usage.outputTokens ? Math.max(allowance, reported) : reported;
};

/** A diagnostic call's judgment checked against the full contract, using the lines and claims in its content. */
export function validateDiagnostic(content: string, judgment: ProviderJudgment) {
  const cases = [...content.matchAll(/^(D\d\d): (.*)$/gm)].map((match) => ({ id: match[1], claim: match[2] }));
  return validateClaims(referencedLines(content), cases, judgment);
}

/**
 * Whether a failure would also break the calls after it: the model or key is wrong, a parameter is refused, the
 * smallest call is already too large, or the account is rate-limited. A malformed tool call is what's being
 * diagnosed, so it doesn't stop the run.
 */
export function stopsTheRun(run: CallRun<unknown>, isFirst: boolean): string | undefined {
  if (run.status !== "provider failure" || !run.error) return undefined;
  const status = Number(run.error.match(/status (\d+)/)?.[1]);
  if ([401, 403, 404].includes(status)) return `the provider refused the key or model (status ${status})`;
  if (run.error.includes("rate limit")) return "rate-limited: a later call would be refused too";
  if (run.error.includes("request too large") && isFirst) return "the smallest call was already too large";
  if (status === 400 && run.errorCode !== "tool_use_failed" && !run.error.includes("malformed tool call")) return `a request parameter was refused (${run.errorCode ?? "status 400"})`;
  return undefined;
}

