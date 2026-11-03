"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/app-shell";
import { ClaudeCliDiagnostic } from "@/components/claude-cli-diagnostic";
import { OutgoingReviewPanel } from "@/components/outgoing-review";
import { Button } from "@/components/ui/button";
import { DIAGNOSTIC_BASELINE } from "@/lib/connection-diagnostic.mjs";
import { privateTerms } from "@/lib/household";
import { engineBaseline } from "@/lib/inventory";
import { LOCAL_SHORT_STEP_REASON, localConnectionStateSchema, localConnectionViewSchema, type LocalConnectionState } from "@/lib/local-connection-contracts";
import { getLocalPrivacyStorage, loadLocalSessionPrivacy, localSessionMaskRules, newLocalSessionPrivacy, saveLocalPrivacyDraft, saveLocalSessionPrivacy, withLocalSessionPrivacyLock, type LocalSessionPrivacy } from "@/lib/local-session-privacy";
import { createApprover, editReview, prepareReview, type ApproveResult, type OutgoingReview } from "@/lib/outgoing-review";
import type { MaskTerm } from "@/utils/obfuscator";
import { useHouseholdStore } from "@/store/useHouseholdStore";
import { usePrivacyStore } from "@/store/usePrivacyStore";

const receiptSchema = z.object({ sessionId: z.string().uuid(), revision: z.number() });
type ApprovedWrite =
  | { action: "create"; approval: { id: string; text: string } }
  | { action: "response"; approval: { id: string; text: string }; command: { sessionId: string; expectedRevision: number; key: string } };
class LocalRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function call(input: unknown): Promise<unknown> {
  const response = await fetch("/api/local-connection", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    cache: "no-store",
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = z.object({ error: z.string() }).safeParse(body);
    throw new LocalRequestError(parsed.success ? parsed.data.error : "Local connection request failed.", response.status);
  }
  return body;
}

export default function ConnectionsPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [setupCode, setSetupCode] = useState("");
  const [view, setView] = useState<z.infer<typeof localConnectionViewSchema>>();
  const [session, setSession] = useState<LocalConnectionState>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [input, setInput] = useState("");
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number }>();
  const [permission, setPermission] = useState<"read" | "write">("read");
  const [review, setReview] = useState<OutgoingReview>();
  const [notice, setNotice] = useState<string>();
  const [blocked, setBlocked] = useState<string[]>();
  const reviewTarget = useRef<{ sessionId: string; revision: number } | undefined>(undefined);
  const baselineApprovalId = useRef<string | undefined>(undefined);
  const [sessionPrivacy, setSessionPrivacy] = useState<LocalSessionPrivacy>();
  const [privacyProblem, setPrivacyProblem] = useState<string>();
  const [pending, setPending] = useState<ApprovedWrite>();
  const [reviewRules, setReviewRules] = useState<MaskTerm[]>([]);

  const refresh = async (sessionId?: string) => {
    const next = localConnectionViewSchema.parse(await call({ action: "status" }));
    setView(next);
    setUnlocked(true);
    if (sessionId) {
      const restored = localConnectionStateSchema.parse(await call({ action: "state", sessionId }));
      setSession(restored);
      setSessionPrivacy(undefined);
      const storage = getLocalPrivacyStorage();
      const privacy = storage
        ? loadLocalSessionPrivacy(storage, restored.id, restored.baseline.id)
        : { status: "unavailable" as const };
      if (privacy.status === "ready") {
        setSessionPrivacy(privacy.context);
        setPrivacyProblem(undefined);
      } else {
        setPrivacyProblem(privacy.status === "missing"
          ? "No browser-private privacy context is saved for this session."
          : privacy.status === "corrupt"
            ? "The browser-private privacy context for this session is invalid or does not match its saved briefing."
            : "Browser storage could not restore or associate this session's privacy context.");
      }
    }
  };
  useEffect(() => {
    let active = true;
    call({ action: "status" }).then(body => {
      if (active) { setView(localConnectionViewSchema.parse(body)); setUnlocked(true); }
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : "Could not read local connection status.");
    });
    return () => { active = false; };
  }, []);

  const run = async (operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try { await operation(); }
    catch (failure) {
      if (failure instanceof LocalRequestError && failure.status === 401) {
        setUnlocked(false); setView(undefined); setSession(undefined); setPairing(undefined);
        setSessionPrivacy(undefined); setPrivacyProblem(undefined);
      }
      setError(failure instanceof Error ? failure.message : "Local connection operation failed.");
    }
    finally { busyRef.current = false; setBusy(false); }
  };
  const save = async (write: ApprovedWrite) => {
    const receipt = receiptSchema.parse(await call(write));
    setPending(undefined);
    setInput("");
    await refresh(receipt.sessionId);
  };
  const approve = async (current: OutgoingReview): Promise<ApproveResult> => {
    if ((!sessionPrivacy || privacyProblem) && current.kind === "response") {
      setPrivacyProblem("This session's browser-private privacy context is unavailable. Response submission is blocked.");
      return { status: "blocked" as const, problems: ["Restore or reassociate this session's browser-private privacy context before reviewing a response."] };
    }
    let restored = sessionPrivacy;
    if (current.kind === "response") {
      const target = reviewTarget.current;
      const storage = getLocalPrivacyStorage();
      const privacy = target && storage && session
        ? loadLocalSessionPrivacy(storage, target.sessionId, session.baseline.id) : undefined;
      if (!target || !privacy || privacy.status !== "ready") {
        setPrivacyProblem("This session's browser-private context could not be restored. Nothing was saved or sent.");
        return { status: "blocked", problems: ["Restore this session's private context before reviewing again."] };
      }
      const saved = localConnectionStateSchema.parse(await call({ action: "state", sessionId: target.sessionId }));
      if (saved.revision !== target.revision || saved.pendingResponse || saved.phase !== "loop") {
        await refresh(target.sessionId);
        setReview(undefined);
        setReviewRules([]);
        setError("The saved exercise changed in another tab. Review the refreshed state before preparing another response.");
        return { status: "blocked", problems: ["The saved exercise changed in another tab. Review the refreshed state before preparing another response."] };
      }
      restored = privacy.context;
    }
    const candidate: LocalSessionPrivacy = restored
      ? { ...restored, entityMap: { ...restored.entityMap }, alwaysMask: localSessionMaskRules(restored.alwaysMask, usePrivacyStore.getState().alwaysMask, reviewRules) }
      : {
          version: 1,
          baselineApprovalId: baselineApprovalId.current ?? crypto.randomUUID(),
          entityMap: {},
          alwaysMask: current.alwaysMask.map(term => typeof term === "string" ? term : { ...term }),
        };
    let approvedWrite: ApprovedWrite | undefined;
    const approver = createApprover({
      ledger: () => candidate.entityMap,
      addMapping: (value, tag) => { candidate.entityMap[tag] = value; },
      alwaysMask: () => candidate.alwaysMask,
      send: (text, approved) => {
        const storage = getLocalPrivacyStorage();
        const approval = {
          id: approved.kind === "baseline" ? candidate.baselineApprovalId : crypto.randomUUID(),
          text,
        };
        const target = reviewTarget.current;
        if (approved.kind === "baseline") {
          if (!storage || !saveLocalPrivacyDraft(storage, candidate)) {
            setError("Browser-private masking context could not be saved (storage may be blocked or full). No briefing was sent. Allow local site storage and review again.");
            return;
          }
          setSessionPrivacy(candidate);
        } else {
          if (!target || !storage || !saveLocalSessionPrivacy(storage, target.sessionId, candidate)) {
            setPrivacyProblem("Browser storage could not save this session's updated privacy context. The response was not sent; free or allow local site storage, then review again.");
            return;
          }
          setSessionPrivacy(candidate);
          setPrivacyProblem(undefined);
        }

        const write: ApprovedWrite = approved.kind === "baseline"
          ? { action: "create", approval }
          : target
            ? { action: "response", approval, command: {
                sessionId: target.sessionId, expectedRevision: target.revision, key: crypto.randomUUID(),
              } }
            : (() => { throw new Error("The response review has no saved exercise target."); })();
        approvedWrite = write;
      },
    });
    const result = approver(current);
    if (approvedWrite) {
      setPending(approvedWrite);
      setReview(undefined);
      setReviewRules([]);
      await save(approvedWrite);
    }
    return result;
  };
  const openReview = (kind: "baseline" | "response") => {
    if (busyRef.current || pending || review) return;
    setReviewRules([]);
    const profile = useHouseholdStore.getState().profile;
    if (kind === "baseline") {
      setPairing(undefined);
      setSession(undefined);
      setSessionPrivacy(undefined);
      setPrivacyProblem(undefined);
      setInput("");
      reviewTarget.current = undefined;
      baselineApprovalId.current = crypto.randomUUID();
      const privacy = usePrivacyStore.getState();
      const context = newLocalSessionPrivacy(baselineApprovalId.current, [
        ...privacy.alwaysMask,
        ...privateTerms(profile),
      ]);
      setSessionPrivacy(context);
      setReview(prepareReview("baseline", transform => engineBaseline(profile, transform), context.entityMap, context.alwaysMask, { profile }));
      setNotice(undefined);
      setBlocked(undefined);
      return;
    }
    if (!session || !sessionPrivacy || privacyProblem) {
      setPrivacyProblem("This session's browser-private privacy context is unavailable. Response submission is blocked; current household details will not be used as a substitute.");
      return;
    }
    reviewTarget.current = { sessionId: session.id, revision: session.revision };
    setNotice(undefined);
    setBlocked(undefined);
    setReview(prepareReview("response", transform => transform(input), sessionPrivacy.entityMap,
      localSessionMaskRules(sessionPrivacy.alwaysMask, usePrivacyStore.getState().alwaysMask)));
  };
  const disabled = busy || !!review || !!pending;
  const diagnostic = session?.baseline.text === DIAGNOSTIC_BASELINE;
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-6">
      <PageHeader title="Local assistant connection" />
      <p className="text-sm text-ink-2">
        Experimental, local-only setup. No Claude extension is installed by this screen.
        ReadyState saves approved masked exercise data locally; ask your connected assistant to generate a turn.
        Refresh to see accepted results. This screen never calls a model provider.
      </p>
      <p className="text-sm text-ink-2">
        This is a separate exercise from the ordinary API exercise screen. Accepted results stay masked here,
        including after restart. Its private masking context is kept separately in this browser. If that context
        is missing or damaged, responses are blocked rather than guessed from the current household or global map.
        Masking is not guaranteed anonymity. Data is not encrypted.
      </p>
      <p className="text-sm text-ink-2">Unreviewed typing, previews and unconfirmed retry copies stay in this tab only.
        Refresh saved sessions before repeating an operation whose result is uncertain. Locking setup does not revoke paired connections;
        revoke them separately below.</p>
      {error && <p role="alert" className="rounded-control border border-line p-3">{error}</p>}
      {!unlocked ? (
        <form className="space-y-3" onSubmit={event => {
          event.preventDefault();
          void run(async () => { await call({ action: "unlock", code: setupCode }); setSetupCode(""); await refresh(); });
        }}>
          <label className="block text-sm font-semibold" htmlFor="owner-code">One-time local owner setup code</label>
          <input id="owner-code" type="password" autoComplete="off" value={setupCode} onChange={event => setSetupCode(event.target.value)}
            className="w-full rounded-control border border-line p-2" />
          <p className="text-sm text-ink-2">Use the code configured by the local operator. It is not your Claude password or an API key.
            If the owner session expires, the operator must configure a new random setup code and restart.</p>
          <Button disabled={busy || !setupCode}>Unlock local setup</Button>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button disabled={disabled} onClick={() => void run(() => refresh(session?.id))}>Refresh accepted results</Button>
            <Button variant="outline" disabled={disabled} onClick={() => void run(async () => {
              await call({ action: "lock" }); setUnlocked(false); setView(undefined); setSession(undefined); setPairing(undefined);
            })}>Lock setup</Button>
            <Button variant="outline" disabled={disabled} onClick={() => openReview("baseline")}>Review new household briefing</Button>
          </div>
          <section aria-label="Fictional connection diagnostic" className="space-y-2 rounded-panel border border-line p-4">
            <h2 className="text-lg font-semibold">Test the connection first</h2>
            <p className="text-sm text-ink-2">Creates a separate, fixed fictional test with no household data.
              Use the experimental in-ReadyState Claude diagnostic below, or the optional assistant-hosted MCP connector.
              No model is called by this creation button.</p>
            <Button className="max-w-full whitespace-normal" disabled={disabled} onClick={() => void run(async () => {
              setPairing(undefined);
              setSession(undefined);
              setSessionPrivacy(undefined);
              setPrivacyProblem(undefined);
              setInput("");
              setPermission("write");
              const write: ApprovedWrite = { action: "create", approval: { id: crypto.randomUUID(), text: DIAGNOSTIC_BASELINE } };
              setPending(write);
              await save(write);
            })}>Create fictional connection diagnostic</Button>
          </section>
          <section aria-label="Saved local sessions" className="space-y-2">
            <h2 className="text-lg font-semibold">Saved local sessions</h2>
            {view?.sessions.length === 0 && <p>No local assistant exercises yet.</p>}
            {view?.sessions.map(value => (
              <Button key={value.id} variant="outline" disabled={disabled} onClick={() => {
                setPairing(undefined);
                setInput("");
                setSession(undefined);
                setSessionPrivacy(undefined);
                setPrivacyProblem(undefined);
                setReview(undefined);
                reviewTarget.current = undefined;
                void run(() => refresh(value.id));
              }}>Resume {value.id.slice(0, 8)} · {value.phase}</Button>
            ))}
          </section>
          {pending && <section className="space-y-2" aria-label="Unconfirmed save">
            <p role="status">This approved save has not been confirmed. Retry uses the same text and approval reference.
              Do not assume the previous attempt failed.</p>
            <Button disabled={busy} onClick={() => void run(() => save(pending))}>Retry approved save</Button>
            <Button disabled={busy} variant="outline" onClick={() => void run(async () => {
              await refresh(pending.action === "response" ? pending.command.sessionId : session?.id);
              setPending(undefined);
              setError("Retry cleared from this tab. Review the refreshed saved sessions before preparing another response.");
            })}>Clear retry and review saved state</Button>
          </section>}
          {session && <section className="space-y-4 rounded-panel border border-line p-4">
            <h2 className="text-lg font-semibold">Exercise {session.id.slice(0, 8)} · {session.phase}</h2>
            {diagnostic && <div role="status" aria-label="Diagnostic result" className="space-y-2">
              <h3 className="font-semibold">{session.events.length ? "Diagnostic acknowledgement saved" : "Waiting for diagnostic acknowledgement"}</h3>
              <p>This verifies transport and saving only, not scenario quality or independently verified model identity.
                For the optional MCP connector, model selection stays in the assistant and model evidence is unavailable.</p>
              <ClaudeCliDiagnostic key={session.id} sessionId={session.id} accepted={session.events.length > 0}
                onSaved={() => refresh(session.id)} />
              <label htmlFor="diagnostic-session" className="block font-semibold">Diagnostic session ID</label>
              <input id="diagnostic-session" readOnly value={session.id} className="w-full rounded-control border border-line p-2 font-mono" />
              <p>Optional assistant-hosted MCP path: configure the source connector for this ID and exact origin, create a write-enabled pairing code below,
                then call readystate_connection_status, readystate_get_diagnostic and readystate_submit_diagnostic in the assistant.
                Refresh here to inspect the saved acknowledgement.</p>
            </div>}
            {!diagnostic && privacyProblem && <div role="alert" aria-label="Privacy context unavailable" className="space-y-2 rounded-control border border-line p-3">
              <h3 className="font-semibold">Privacy context unavailable</h3>
              <p>{privacyProblem} Responses are blocked. ReadyState will not infer safety from the current household or another exercise&apos;s privacy map.</p>
              <p>If this session was just created, use &ldquo;Refresh accepted results&rdquo; to retry browser-local association. If the context is still missing or corrupt, this saved session is read-only; create a new local session after reviewing its briefing.</p>
            </div>}
            <details><summary>Approved masked briefing</summary><p className="whitespace-pre-wrap break-words">{session.baseline.text}</p></details>
            {session.events.map(event => <article key={event.id} className="space-y-2 border-t border-line pt-3">
              <h3 className="font-semibold">{event.turn.time_elapsed} · Accepted simulated event</h3>
              {event.response && <p className="whitespace-pre-wrap break-words">Participant: {event.response.text}</p>}
              <p className="whitespace-pre-wrap break-words">{event.turn.narrative_response}</p>
              <p className="whitespace-pre-wrap break-words">{event.turn.new_inject}</p>
              {event.generator && <p>
                Service: Claude Code {event.generator.runtimeVersion}. Requested model: {event.generator.requestedModel}.
                CLI-reported model evidence (unverified): {event.generator.reportedModels.join(", ") || "unavailable"}.
              </p>}
              {event.turn.feedback && <div>
                <p>Feedback: {event.turn.feedback.covered.join(" ")} {event.turn.feedback.consider.join(" ")}</p>
                <p>{event.turn.feedback.why}</p>
              </div>}
              <ul>{event.turn.critical_alerts.map((text, index) => <li key={index}>{text}</li>)}</ul>
              <ul>{event.turn.suggested_actions.map((text, index) => <li key={index}>Suggested step: {text}</li>)}</ul>
              <ul>{event.turn.response_options.map((text, index) => <li key={index}>{text}</li>)}</ul>
            </article>)}
            {session.pendingResponse && <div className="space-y-2">
              <p className="whitespace-pre-wrap break-words">Approved response waiting for the assistant: {session.pendingResponse.text}</p>
              <p className="text-sm text-ink-2">Withdrawing removes this response from future context and invalidates its outstanding task.
                It cannot recall information the connector or Claude has already retrieved.</p>
              <Button className="max-w-full whitespace-normal" variant="outline" disabled={disabled} onClick={() => void run(async () => {
                await call({ action: "withdraw-response", command: { sessionId: session.id, expectedRevision: session.revision, key: crypto.randomUUID() } });
                setInput("");
                setPairing(undefined);
                await refresh(session.id);
              })}>Withdraw approved response</Button>
            </div>}
            {session.pendingResponse && !session.task && <details className="space-y-2">
              <summary>Optional shorter crisis interval</summary>
              <p className="text-sm text-ink-2">Normally the clock advances 6-12 hours. This authorizes one shorter crisis step;
                the assistant must still advance time. A final step ending exactly at Hour 72 needs no exception.
                Choosing this releases only the fixed statement below to the connection:</p>
              <p>{LOCAL_SHORT_STEP_REASON}</p>
              <Button className="max-w-full whitespace-normal" disabled={disabled} onClick={() => void run(async () => {
                await call({ action: "short-step", command: { sessionId: session.id, expectedRevision: session.revision, key: crypto.randomUUID() }, reason: LOCAL_SHORT_STEP_REASON });
                await refresh(session.id);
              })}>Authorize a shorter crisis step</Button>
              {session.shortStepReason && <p className="break-words">Authorized for the next task: {session.shortStepReason}</p>}
            </details>}
            {!diagnostic && session.phase === "loop" && !session.pendingResponse && <div className="space-y-2">
              <label htmlFor="local-response" className="block font-semibold">Your next decision</label>
              <textarea id="local-response" value={input} disabled={disabled} onChange={event => setInput(event.target.value)}
                className="min-h-28 w-full rounded-control border border-line p-2" />
              <Button disabled={disabled || !input.trim() || !sessionPrivacy || !!privacyProblem} onClick={() => openReview("response")}>Review response</Button>
            </div>}
            {session.task && <Button className="max-w-full whitespace-normal" variant="outline" disabled={disabled} onClick={() => void run(async () => {
              await call({ action: "cancel", command: { sessionId: session.id, expectedRevision: session.revision, key: crypto.randomUUID() } });
              await refresh(session.id);
            })}>Cancel outstanding generation task</Button>}
            {session.phase === "ended" && <p>Hour 72 reached. Checked debrief submission is not connected yet.</p>}
            <div className="space-y-2 border-t border-line pt-3">
              <label htmlFor="connection-permission" className="block font-semibold">Connection permission for this exercise only</label>
              <select id="connection-permission" disabled={disabled} value={permission}
                onChange={event => setPermission(event.target.value === "write" ? "write" : "read")}
                className="w-full min-w-0 max-w-full rounded-control border border-line p-2">
                <option value="read">Read approved exercise state only</option>
                <option value="write">Read context and submit generated turns</option>
              </select>
              <p className="text-sm text-ink-2">Write access does not permit approving participant responses, changing the household,
                replacing history or granting more connections. Share the pairing code only with your local connector.</p>
              <Button className="max-w-full whitespace-normal" disabled={disabled} onClick={() => void run(async () => {
                setPairing(undefined);
                const next = z.object({ code: z.string(), expiresAt: z.number() }).parse(await call({ action: "pair", sessionId: session.id, permission }));
                setPairing(next); await refresh(session.id);
              })}>Create five-minute pairing code</Button>
              {pairing && <div role="status">
                <label htmlFor="pairing-code" className="block font-semibold">One-use pairing code</label>
                <input id="pairing-code" readOnly value={pairing.code} autoComplete="off" className="w-full rounded-control border border-line p-2 font-mono" />
                <p>Expires {new Date(pairing.expiresAt).toLocaleTimeString()}. Do not paste it into a Claude conversation.
                  The future extension will accept it in local configuration.</p>
                <Button variant="outline" onClick={() => setPairing(undefined)}>Hide code</Button>
              </div>}
            </div>
          </section>}
          <section aria-label="Connections" className="space-y-2">
            <h2 className="text-lg font-semibold">Connections and unredeemed codes</h2>
            {view?.connections.map(connection => <div key={connection.id} className="flex flex-wrap items-center gap-2">
              <p>{connection.id.slice(0, 8)} · exercise {connection.sessionId.slice(0, 8)} · {connection.permission} ·
                {connection.paired ? " paired" : " code pending"} · expires {new Date(connection.expiresAt).toLocaleString()}</p>
              <Button variant="outline" disabled={disabled} onClick={() => void run(async () => {
                await call({ action: "revoke", connectionId: connection.id }); setPairing(undefined); await refresh(session?.id);
              })}>Revoke {connection.id.slice(0, 8)}</Button>
            </div>)}
          </section>
        </>
      )}
      {review && <OutgoingReviewPanel review={review} notice={notice} blocked={blocked} sending={busy} delivery="local-connection"
        onEdit={text => setReview(editReview(review, text))}
        onBack={() => { setReview(undefined); setReviewRules([]); }}
        onMask={value => {
          if (!sessionPrivacy) {
            setError("Browser-private masking context is unavailable. This review cannot add a rule or send until its context is restored.");
            return;
          }
          const nextRules = localSessionMaskRules(reviewRules, [value]);
          setReviewRules(nextRules);
          setReview(prepareReview(review.kind, review.build, { ...review.base },
            localSessionMaskRules(sessionPrivacy.alwaysMask, usePrivacyStore.getState().alwaysMask, nextRules), review.start));
          setNotice("Masking updated for this session only. The new rule stays in this tab until Send. Review the rebuilt text.");
        }}
        onSend={() => {
          if (busyRef.current) return;
          void run(async () => {
            const operation = async () => {
              const result = await approve(review);
              if (result.status === "blocked") setBlocked(result.problems);
              else if (result.status === "review-again") { setReview(result.review); setNotice(result.reason); }
            };
            const target = reviewTarget.current;
            if (review.kind === "response" && target) await withLocalSessionPrivacyLock(target.sessionId, operation);
            else await operation();
          });
        }} />}
    </main>
  );
}
