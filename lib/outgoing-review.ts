import type { HouseholdProfile } from "@/lib/household";
import { maskInput, type MaskTerm } from "@/utils/obfuscator";

/**
 * Reviewing what leaves the browser before it's sent (work item S2). The
 * participant sees the exact masked text, can edit it, and sends it with an
 * explicit action. Nothing here sends anything: `approve` checks a review and,
 * only when it passes, hands its text to the caller's `send`.
 */

export type ReviewKind = "baseline" | "response";

/** Builds the outgoing text, masking each private part with `mask`. */
export type BuildOutgoing = (mask: (text: string) => string) => string;

export interface OutgoingReview {
  /** Unique per prepared review, so the same review can't be sent twice. */
  id: number;
  kind: ReviewKind;
  /** Rebuilds the text from its source: the typed response or the household profile. */
  build: BuildOutgoing;
  /** The masked text as built, before any edits. */
  generated: string;
  /** What will be sent: the generated text, possibly edited. */
  text: string;
  /** The privacy ledger the text was masked against. */
  base: Readonly<Record<string, string>>;
  /** Tags this review introduced. They join the ledger only when it's sent. */
  pending: Readonly<Record<string, string>>;
  /** For a baseline: the household the exercise starts with, once it's sent. */
  start?: { profile: HouseholdProfile; sampleId?: string };
}

let lastId = 0;

/** Masks a message for review without recording anything in the privacy ledger. */
export function prepareReview(
  kind: ReviewKind,
  build: BuildOutgoing,
  base: Record<string, string>,
  alwaysMask: MaskTerm[],
  start?: OutgoingReview["start"],
): OutgoingReview {
  const ledger = { ...base };
  const text = build((part) => maskInput(part, { alwaysMask, ledger }));
  return { id: ++lastId, kind, build, generated: text, text, base: { ...base }, pending: added(base, ledger), start };
}

const added = (base: Record<string, string>, ledger: Record<string, string>) =>
  Object.fromEntries(Object.entries(ledger).filter(([tag]) => !(tag in base)));

/** The same review with edited text. */
export const editReview = (review: OutgoingReview, text: string): OutgoingReview => ({ ...review, text });

export const isEdited = (review: OutgoingReview) => review.text !== review.generated;

const BRACKETED = /\[[^[\]\n]*\]/g;

/**
 * Damaged or unknown placeholder tags in an edited review: "[Person 1" with
 * its bracket deleted, or a tag the ledger doesn't know, which would reach the
 * model as a real-looking placeholder and never be restored. Removing a whole
 * tag is fine.
 */
export function tagProblems(review: OutgoingReview): string[] {
  const known = new Set([...Object.keys(review.base), ...Object.keys(review.pending), ...(review.generated.match(BRACKETED) ?? [])]);
  const problems = [...new Set(review.text.match(BRACKETED) ?? [])]
    .filter((tag) => !known.has(tag))
    .map((tag) => `${tag} isn't one of this message's tags. Restore the original tag or delete it.`);
  const fragment = review.text.replace(BRACKETED, " ").match(/\S*[[\]]\S*/);
  if (fragment) problems.push(`A tag looks damaged near "${fragment[0]}". Restore it or delete the whole tag.`);
  return problems;
}

/** The tags in a review's text with the real values they stand for, which stay on this device. */
export function reviewTags(review: OutgoingReview): [tag: string, value: string][] {
  const values = { ...review.base, ...review.pending };
  return [...new Set(review.text.match(BRACKETED) ?? [])].filter((tag) => tag in values).map((tag) => [tag, values[tag]]);
}

/** Plain text to add to the always-mask list, or why the selection can't be used. */
export function maskableSelection(selected: string): { value: string } | { problem: string } {
  const value = selected.trim();
  if (!value) return { problem: "Select a word or phrase in the message first." };
  if (/[[\]]/.test(value)) return { problem: "Select plain text, not a tag." };
  if (value.length > 80) return { problem: "Select a shorter phrase, up to 80 characters." };
  return { value };
}

/**
 * Masks only the lines the participant edited. Lines left as built aren't
 * masked again: the baseline's official guidance is public text, deliberately
 * unmasked, where a second pass could tag words like "Ready.gov".
 */
function remaskEdits(review: OutgoingReview, mask: (line: string) => string): string {
  const built = new Set(review.generated.split("\n"));
  return review.text
    .split("\n")
    .map((line) => (built.has(line) ? line : mask(line)))
    .join("\n");
}

export type ApproveResult =
  | { status: "sent" }
  /** Sending was refused; the review is unchanged. */
  | { status: "blocked"; problems: string[] }
  /** The text changed before sending; show it again for approval. */
  | { status: "review-again"; review: OutgoingReview; reason: string }
  | { status: "duplicate" };

export interface ApproveDeps {
  /** The privacy ledger as it is now. */
  ledger: () => Record<string, string>;
  addMapping: (value: string, tag: string) => void;
  alwaysMask: () => MaskTerm[];
  /** Sends the approved review's text. Called at most once per review. */
  send: (text: string, review: OutgoingReview) => void;
}

/**
 * Sends a review exactly as approved, or explains why it can't be sent yet.
 * Edits are masked again first: if that would change anything, such as a name
 * typed into the copy, the participant sees the result before it's sent.
 * Returns "duplicate" for a review that was already sent, so a double click
 * submits once.
 */
export function createApprover(deps: ApproveDeps) {
  const sent = new Set<number>();
  return (review: OutgoingReview): ApproveResult => {
    if (sent.has(review.id)) return { status: "duplicate" };
    if (!review.text.trim()) return { status: "blocked", problems: ["The message is empty."] };
    const problems = tagProblems(review);
    if (problems.length) return { status: "blocked", problems };

    const now = deps.ledger();
    const changed = Object.keys(now).length !== Object.keys(review.base).length || Object.entries(review.base).some(([tag, value]) => now[tag] !== value);
    if (changed) {
      return {
        status: "review-again",
        review: prepareReview(review.kind, review.build, now, deps.alwaysMask(), review.start),
        reason: "The privacy tags changed since this preview was made, so it was rebuilt. Review it again, then send.",
      };
    }

    const ledger = { ...review.base, ...review.pending };
    const remasked = remaskEdits(review, (line) => maskInput(line, { alwaysMask: deps.alwaysMask(), ledger }));
    if (remasked !== review.text) {
      return {
        status: "review-again",
        review: { ...review, id: ++lastId, text: remasked, pending: added(review.base, ledger) },
        reason: "Your edits contained details that are masked, so they were replaced with tags. Review the message again, then send.",
      };
    }

    sent.add(review.id);
    for (const [tag, value] of Object.entries(review.pending)) deps.addMapping(value, tag);
    deps.send(review.text, review);
    return { status: "sent" };
  };
}
