"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { claudeCliStatusSchema, claudeRequestedModelSchema } from "@/lib/claude-cli-contracts";
import { localConnectionStateSchema } from "@/lib/local-connection-contracts";
import { DIAGNOSTIC_CLI_REQUEST, diagnosticTurn } from "@/lib/connection-diagnostic.mjs";

async function request(input: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch("/api/local-connection", {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
    body: JSON.stringify(input), signal,
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(body);
    throw new Error(error.success ? error.data.error : "The Claude diagnostic request failed.");
  }
  return body;
}

export function ClaudeCliDiagnostic({ sessionId, accepted, onSaved }: {
  sessionId: string; accepted: boolean; onSaved: () => Promise<void>;
}) {
  const [status, setStatus] = useState<z.infer<typeof claudeCliStatusSchema>>();
  const [model, setModel] = useState<z.infer<typeof claudeRequestedModelSchema>>("sonnet");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  const run = async (send: boolean) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    try {
      if (send) {
        localConnectionStateSchema.parse(await request({ action: "claude-diagnostic", sessionId, model }, controller.signal));
        await onSaved();
      } else {
        setStatus(claudeCliStatusSchema.parse(await request({ action: "claude-status" }, controller.signal)));
      }
    } catch (failure) {
      setError(controller.signal.aborted
        ? "Cancellation requested. Refresh accepted results before retrying; an already saved acknowledgement is retained."
        : failure instanceof Error ? failure.message : "The Claude diagnostic failed.");
      if (send) setStatus(undefined);
    } finally { active.current = null; setBusy(false); }
  };

  return <section aria-label="In-ReadyState Claude diagnostic" className="space-y-2 rounded-control border border-line p-3">
    <h3 className="font-semibold">Claude inside ReadyState · experimental diagnostic</h3>
    <p>Sign-in stays in the native Claude Code flow: run <code>claude auth login</code> in your terminal.
      Never paste a password, token or API key here. Return here to check the connection and send the fictional test.</p>
    <p>Subscription-use approval and live runtime qualification remain pending. Inference is disabled by default.
      No automatic paid API fallback is available. The test may consume subscription allowance or account-configured extra usage.</p>
    <Button variant="outline" disabled={busy} onClick={() => void run(false)}>Check installed Claude and sign-in</Button>
    {status && <p role="status">
      Runtime: {status.installed ? `Claude Code ${status.version}` : "not found"}.
      Authentication: {status.authentication}. Evaluation: {status.evaluationEnabled ? "operator-enabled, unqualified" : "disabled"}.
      Model evidence is recorded only when the CLI returns it; it does not verify model weights.
    </p>}
    <label htmlFor="claude-diagnostic-model" className="block font-semibold">Requested Claude model</label>
    <select id="claude-diagnostic-model" value={model} disabled={busy || accepted}
      className="w-full rounded-control border border-line p-2"
      onChange={event => setModel(claudeRequestedModelSchema.parse(event.target.value))}>
      <option value="sonnet">Sonnet</option><option value="opus">Opus</option><option value="haiku">Haiku</option>
    </select>
    <p>ReadyState supplies only the fixed fictional briefing and exact acknowledgement shown below,
      not household facts, exercise history or browser-private masking context.
      The native CLI supplies its own system context; use a clean test profile without personal instructions.</p>
    <details><summary>Fixed fictional request and acknowledgement</summary>
      <pre className="whitespace-pre-wrap break-words text-sm">{`${DIAGNOSTIC_CLI_REQUEST}${JSON.stringify(diagnosticTurn, null, 2)}`}</pre>
    </details>
    <Button disabled={busy || accepted || !status?.evaluationEnabled || status.authentication !== "native-subscription"}
      onClick={() => void run(true)}>Send fictional diagnostic to Claude</Button>
    {busy && <Button variant="outline" onClick={() => active.current?.abort()}>Cancel Claude request</Button>}
    {accepted && <p>Saved result retained. Create a new fictional diagnostic for another model call.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
