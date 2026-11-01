import { beforeEach, describe, expect, it, vi } from "vitest";

import { privateTerms } from "@/lib/household";
import { engineBaseline } from "@/lib/inventory";
import {
  createApprover,
  editReview,
  isEdited,
  maskableSelection,
  prepareReview,
  reviewTags,
  tagProblems,
  type OutgoingReview,
} from "@/lib/outgoing-review";
import { TEST_HOUSEHOLDS } from "@/lib/test-households";
import { usePrivacyStore } from "@/store/usePrivacyStore";
import { maskInput } from "@/utils/obfuscator";

const sam = TEST_HOUSEHOLDS.find((h) => h.id === "sam")!.profile;
const terms = privateTerms(sam);
const ledger = () => usePrivacyStore.getState().entityMap;

const baselineReview = () => prepareReview("baseline", (mask) => engineBaseline(sam, mask), ledger(), terms);
const responseReview = (raw: string) => prepareReview("response", (mask) => mask(raw), ledger(), terms);

/** An approver wired to the real privacy store, with a spy for what's sent. */
const approver = () => {
  const send = vi.fn<(text: string, review: OutgoingReview) => void>();
  const approve = createApprover({
    ledger,
    addMapping: (value, tag) => usePrivacyStore.getState().addMapping(value, tag),
    alwaysMask: () => terms,
    send,
  });
  return { approve, send };
};

beforeEach(() => usePrivacyStore.getState().clearMappings());

describe("prepareReview", () => {
  it("masks the complete baseline exactly as the send path would, and records nothing until it's sent", () => {
    const review = baselineReview();
    const dryRun = engineBaseline(sam, (text) => maskInput(text, { alwaysMask: terms, dryRun: true }));
    expect(review.text).toBe(dryRun);
    expect(review.text).not.toMatch(/Sam Okafor|Jamie|Mateo|Lucia|Biscuit/);
    expect(review.text).toContain("Official guidance");
    expect(ledger()).toEqual({});
    expect(Object.values(review.pending)).toEqual(expect.arrayContaining(["Sam Okafor", "Biscuit"]));
  });

  it("masks a typed response against the existing ledger, so a name keeps its tag", () => {
    const { approve } = approver();
    const baseline = baselineReview();
    approve(baseline);
    const samTag = Object.entries(ledger()).find(([, value]) => value === "Sam Okafor")![0];

    const review = responseReview("Sam Okafor takes Biscuit out and calls 303-555-0142.");
    expect(review.text).toBe(`${samTag} takes ${reviewTags(review).find(([, v]) => v === "Biscuit")![0]} out and calls [Phone 1].`);
    expect(review.pending).toMatchObject({ "[Phone 1]": "303-555-0142" });
  });
});

describe("tagProblems", () => {
  const review = () => responseReview("Sam Okafor checks the furnace.");

  it("accepts the text as built, and a whole tag deleted", () => {
    const r = review();
    expect(tagProblems(r)).toEqual([]);
    expect(tagProblems(editReview(r, r.text.replace(/\[Person \d+\] /, "")))).toEqual([]);
  });

  it("flags a tag with a bracket deleted, and a tag the ledger doesn't know", () => {
    const r = review();
    expect(tagProblems(editReview(r, "[Person 1 checks the furnace."))[0]).toMatch(/damaged near "\[Person/);
    expect(tagProblems(editReview(r, `${r.text} [Person 9] helps.`))[0]).toMatch(/\[Person 9\] isn't one of this message's tags/);
  });
});

describe("createApprover", () => {
  it("sends exactly the approved text and records its tags only then", () => {
    const { approve, send } = approver();
    const review = responseReview("Sam Okafor checks the furnace.");
    expect(ledger()).toEqual({});

    expect(approve(review)).toEqual({ status: "sent" });
    expect(send).toHaveBeenCalledExactlyOnceWith(review.text, review);
    expect(ledger()).toEqual(review.pending);
  });

  it("sends an edited copy as edited, and the same review only once", () => {
    const { approve, send } = approver();
    const review = editReview(responseReview("Sam Okafor checks the furnace and the pipes."), "");
    const edited = editReview(review, responseReview("Sam Okafor checks the furnace.").text.replace("checks", "inspects"));
    expect(isEdited(edited)).toBe(true);

    expect(approve(edited)).toEqual({ status: "sent" });
    expect(approve(edited)).toEqual({ status: "duplicate" });
    expect(send).toHaveBeenCalledExactlyOnceWith(edited.text, edited);
  });

  it("refuses an empty message or a damaged tag without sending", () => {
    const { approve, send } = approver();
    const review = responseReview("Sam Okafor checks the furnace.");
    expect(approve(editReview(review, "  "))).toMatchObject({ status: "blocked" });
    expect(approve(editReview(review, "Person 1] checks the furnace."))).toMatchObject({ status: "blocked" });
    expect(send).not.toHaveBeenCalled();
    expect(ledger()).toEqual({});
  });

  it("masks a detail typed into the copy and asks for another look before sending", () => {
    const { approve, send } = approver();
    const review = responseReview("We check the furnace.");
    const result = approve(editReview(review, "We check the furnace. Call Jamie Okafor at 303-555-0142."));

    expect(send).not.toHaveBeenCalled();
    expect(result.status).toBe("review-again");
    const again = (result as { review: OutgoingReview }).review;
    expect(again.text).not.toMatch(/Jamie|Okafor|303-555/);
    expect(again.text).toMatch(/Call \[Person \d+\] at \[Phone 1\]\./);

    expect(approve(again)).toEqual({ status: "sent" });
    expect(send).toHaveBeenCalledExactlyOnceWith(again.text, again);
  });

  it("leaves unedited lines alone, so the baseline's public guidance isn't masked again", () => {
    const { approve, send } = approver();
    const review = baselineReview();
    const lines = review.text.split("\n");
    const edited = editReview(review, [lines[0], ...lines.slice(2)].join("\n"));
    expect(approve(edited)).toEqual({ status: "sent" });
    expect(send).toHaveBeenCalledExactlyOnceWith(edited.text, edited);
  });

  it("hands the household a baseline starts to send, even after a rebuild", () => {
    const { approve, send } = approver();
    const start = { profile: sam, sampleId: "sam" };
    const review = prepareReview("baseline", (mask) => engineBaseline(sam, mask), ledger(), terms, start);
    usePrivacyStore.getState().addMapping("555-0100", "[Phone 1]");

    const again = approve(review) as { review: OutgoingReview };
    expect(again.review.start).toBe(start);
    expect(approve(again.review)).toEqual({ status: "sent" });
    expect(send.mock.calls[0][1].start).toBe(start);
  });

  it("rebuilds a review whose ledger changed after it was prepared", () => {
    const { approve, send } = approver();
    const review = responseReview("Call 303-555-0142.");
    usePrivacyStore.getState().addMapping("555-0100", "[Phone 1]");

    const result = approve(review);
    expect(result).toMatchObject({ status: "review-again" });
    expect((result as { review: OutgoingReview }).review.text).toBe("Call [Phone 2].");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("maskableSelection", () => {
  it("accepts plain text and refuses an empty selection, a tag or a long passage", () => {
    expect(maskableSelection("  Ciaran ")).toEqual({ value: "Ciaran" });
    expect(maskableSelection(" ")).toHaveProperty("problem");
    expect(maskableSelection("[Person 1]")).toHaveProperty("problem");
    expect(maskableSelection("x".repeat(81))).toHaveProperty("problem");
  });
});
