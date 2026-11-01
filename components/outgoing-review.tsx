"use client";

import { ArrowLeft, EyeOff, Loader2, Send, ShieldCheck } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { isEdited, maskableSelection, reviewTags, tagProblems, type OutgoingReview } from "@/lib/outgoing-review";

/**
 * The review of what leaves the browser (work item S2): the exact masked text,
 * editable, sent only with an explicit Send. Back sends nothing.
 */
export function OutgoingReviewPanel({
  review,
  notice,
  blocked,
  sending,
  onEdit,
  onMask,
  onSend,
  onBack,
}: {
  review: OutgoingReview;
  /** Why the review was shown again, such as edits that were masked. */
  notice?: string;
  /** Why the last Send was refused. */
  blocked?: string[];
  sending: boolean;
  onEdit: (text: string) => void;
  /** Adds the value to the always-mask list and rebuilds the review. */
  onMask: (value: string) => void;
  onSend: () => void;
  onBack: () => void;
}) {
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [masking, setMasking] = useState<{ value: string } | { problem: string } | null>(null);
  const [confirmingBack, setConfirmingBack] = useState(false);

  // Keyboard and screen-reader users land on the review, not wherever focus was.
  useEffect(() => headingRef.current?.focus(), [review.kind]);

  const problems = tagProblems(review);
  const tags = reviewTags(review);
  const edited = isEdited(review);
  const baseline = review.kind === "baseline";

  const startMask = () => {
    const el = textRef.current;
    setMasking(maskableSelection(el ? el.value.slice(el.selectionStart, el.selectionEnd) : ""));
  };
  const back = () => (edited && !confirmingBack ? setConfirmingBack(true) : onBack());

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="space-y-4 rounded-panel border-2 border-action bg-surface p-4 shadow-panel sm:p-5"
    >
      <div className="space-y-2">
        <h2 id={`${id}-title`} ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-lg font-semibold outline-none">
          <ShieldCheck className="h-5 w-5 shrink-0 text-success" aria-hidden />
          Review what leaves this browser
        </h2>
        <p className="text-sm text-ink-2">
          {baseline
            ? "This is the complete household briefing that will be sent to start the exercise: your household with names and details replaced by tags, then the public guidance it draws on."
            : "This is your response as it will be sent, including any suggested option you started from."}
        </p>
        {!baseline && (
          <p className="text-sm text-ink-2">
            The exercise so far is sent with it, as it was sent before: your earlier responses and the scenario&apos;s turns.
          </p>
        )}
        <p className="text-sm text-ink-2">
          The message goes to this ReadyState server, which sends the conversation to the selected model provider.
          Any API key you entered in Settings also goes to ReadyState&apos;s server to authenticate with that provider;
          it is not part of the model&apos;s conversation text.
        </p>
        <p className="rounded-control border-l-4 border-attention-accent bg-attention-soft px-3 py-2 text-sm text-ink">
          This is a review, not a guarantee of anonymity. Masking can miss details, so read it before sending. Once sent, the
          provider&apos;s own policies decide how long it&apos;s kept; ReadyState can&apos;t recall it.
        </p>
      </div>

      {notice && (
        <p role="status" className="rounded-control bg-action-soft px-3 py-2 text-sm font-semibold text-ink">
          {notice}
        </p>
      )}

      <div className="space-y-1">
        <label htmlFor={`${id}-text`} className="block text-sm font-semibold">
          Outgoing message (you can edit this copy)
        </label>
        <textarea
          id={`${id}-text`}
          ref={textRef}
          value={review.text}
          rows={baseline ? 12 : 6}
          onChange={(event) => onEdit(event.target.value)}
          aria-describedby={`${id}-hint${problems.length ? ` ${id}-problems` : ""}`}
          aria-invalid={problems.length > 0}
          spellCheck={false}
          className="block w-full resize-y rounded-control border border-line-strong bg-field px-3 py-2.5 font-mono text-base text-ink sm:text-sm"
        />
        <p id={`${id}-hint`} className="text-xs text-ink-3">
          Edits change only this message{baseline ? ", not your saved household" : ""}. Keep tags like [Person 1] whole, or
          delete them entirely.
        </p>
      </div>

      {(problems.length > 0 || (blocked && blocked.length > 0)) && (
        <ul id={`${id}-problems`} role="alert" className="space-y-1 rounded-control border border-error bg-error-soft px-3 py-2 text-sm text-error">
          {[...new Set([...problems, ...(blocked ?? [])])].map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      {tags.length > 0 && (
        <details className="rounded-control border border-line px-3 py-2 text-sm">
          <summary className="min-h-11 cursor-pointer content-center font-semibold">
            Tags in this message ({tags.length}): what they stand for stays on this device
          </summary>
          <ul className="mt-2 space-y-1">
            {tags.map(([tag, value]) => (
              <li key={tag} className="flex justify-between gap-3">
                <span className="font-medium text-success">{tag}</span>
                <span className="truncate text-ink-2">{value}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="space-y-2">
        {masking === null ? (
          <Button type="button" variant="outline" size="sm" onClick={startMask} disabled={sending}>
            <EyeOff className="h-4 w-4" aria-hidden />
            Mask selected text
          </Button>
        ) : "problem" in masking ? (
          <div role="status" className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
            <span>{masking.problem}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMasking(null)}>
              OK
            </Button>
          </div>
        ) : (
          <div role="group" aria-label="Confirm masking" className="space-y-2 rounded-control border border-line-strong p-3 text-sm">
            <p>
              Mask <strong className="break-all">&ldquo;{masking.value}&rdquo;</strong> everywhere? It&apos;s added to your
              always-mask list and this preview is rebuilt.
              {edited && <strong> Rebuilding discards your edits to this copy.</strong>}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onMask(masking.value);
                  setMasking(null);
                }}
              >
                {edited ? "Discard edits and mask" : "Mask it"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setMasking(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {confirmingBack && (
        <div role="group" aria-label="Confirm going back" className="space-y-2 rounded-control border border-line-strong p-3 text-sm">
          <p>Go back without sending? Your edits to this copy are discarded{baseline ? "" : "; your typed response is kept"}.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onBack}>
              Discard edits and go back
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmingBack(false)}>
              Keep reviewing
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button type="button" variant="outline" onClick={back} disabled={sending} className="w-full sm:w-auto">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back, don&apos;t send
        </Button>
        <Button type="button" onClick={onSend} disabled={sending || problems.length > 0 || !review.text.trim()} className="w-full sm:w-auto">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          Send this
        </Button>
      </div>
    </section>
  );
}
