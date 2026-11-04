# Claude connection qualification

## Verified source-only baseline (PR #41)

Local evidence applies to code commit
`6d1da4fedbc2fff1c3b52d176f183ebf29ba7811`:

- Source-only tests: **774 passed, 1 skipped, 1 todo across 41 test files**;
  lint, typecheck and production build **PASS**.
- Windows Node 24 / Microsoft Edge fictional CLI harness **PASS**: cancellation,
  usage-limit failure, explicit retry, exactly one saved SQLite event, restart
  recovery and responsive widths; **zero model calls**.
- The new regressions cover serialized saved-result refreshes, current-session
  preservation, persisted mask-rule reload on remount and mask-draft
  synchronization, and refreshing an accepted result after an overlapping
  pre-acceptance refresh.
- Windows package tests: **22 passed, 1 skipped**. Package inspection and
  relocated-package smoke test passed; install/uninstall preserved synthetic
  user files and refused to overwrite an existing destination.
- The private Windows x64 archive has SHA-256
  `2E726585CA7569473F17CDEAE4772D64A96F5DA695B4BD4D33C06CC984AE947D`.
  This archive is a test artifact, not a GitHub release.
- GitHub CI for this code commit is pending.

This is **fiction-only evidence, not live Claude qualification**. Subsequent
code changes invalidate affected evidence and require the affected checks to
be rerun; these results do not qualify a later code revision.

### Private Windows test install

The tested archive is `ReadyState-0.1.0-windows-x64.zip`. It bundles ReadyState
and Node 24, not Claude Code. It was built with inference disabled and provider
keys unset. For an extracted package, run `.\start.ps1` for portable startup,
or install to a new destination and launch it:

```powershell
.\install.ps1 -Destination "$env:LOCALAPPDATA\ReadyState-Test\Installed" -NoShortcut
& "$env:LOCALAPPDATA\ReadyState-Test\Installed\start.ps1"
```

Keep the terminal open; Ctrl+C stops the local server. Then open the local
ReadyState URL it prints. To remove the test app after stopping it:

```powershell
& "$env:LOCALAPPDATA\ReadyState-Test\Installed\uninstall.ps1" -RemoveInstallation
```

The installer refuses an existing destination; it does not upgrade in place.
Synthetic `.env.local` and user-file markers survived refusal and uninstall.
Browser-managed household/settings data was not exercised in this package
test. No Claude executable detection or sign-in was performed during packaging.

## In-ReadyState CLI diagnostic primary gate

The next success criterion is a validated request/response entirely inside
ReadyState's interface. MCP discovery in Claude Desktop is a separate optional
path, documented below, and does not satisfy this gate.

**Status: source-only, inference OFF, live qualification and subscription-use
clarification pending.** Do not advertise subscription support, turn this into
a release, or infer approval from Hermes's implementation. Anthropic documents
[programmatic CLI operation](https://code.claude.com/docs/en/headless) and
[conditional hosting of its unmodified CLI](https://code.claude.com/docs/en/legal-and-compliance);
the exact custom-UI/subscription boundary must be resolved separately.

### Subscription-use decision (separate from engineering qualification)

**Decision owner:** ReadyState product owner. **Status: unresolved; no live
subscription call or distributed support is authorized by this checklist.**

Anthropic's [Claude Code legal terms](https://code.claude.com/docs/en/legal-and-compliance)
say that offering/running Claude Code in a product or service requires the
applicable Commercial Terms and preserving the unmodified binary and its
built-in authentication; each end user must authenticate with their own
credentials, with no reselling or intermediation. The same page bars third
parties from offering Claude.ai login or collecting credentials/tokens, but
allows an end user to sign in to the unmodified CLI, including on a hosted
platform described by those conditions. The [Consumer Terms](https://www.anthropic.com/legal/consumer-terms)
also restrict automated access except where Anthropic explicitly permits it.

**Question for Anthropic, through its listed Contact Sales channel, or qualified
counsel:** Does this exact ReadyState-owned UI invoking the unmodified local
Claude Code CLI, with authentication completed only in Anthropic's native
flow and no credential handling by ReadyState, qualify for the described
platform-hosting exception when used for (a) the maintainer's private local
feasibility test and (b) a product distributed to end users? What terms or
commercial agreement apply separately to each?

Keep those decisions separate: permission for one private, user-authorized
feasibility test would not establish permission to ship or advertise
subscription-based support. Until clarified, do not enable inference or
distribute this path. A future live test would use one fixed fictional request;
it may consume the user's included subscription allowance or trigger
account-configured extra usage. No charge amount or no-cost status is assumed.

1. Complete prerequisite bridge/diagnostic review. Use a disposable private
   local data directory, one server process, no provider API keys and a clean
   native Claude test profile without personal instructions or managed
   provider overrides. Existing bridge owner/origin/storage controls apply.
2. Install the official native Claude Code runtime separately. This source
   evaluation checks `~/.local/bin/claude` (`claude.exe` on Windows), or an
   operator-configured absolute `READYSTATE_CLAUDE_EXECUTABLE`. Shell commands,
   `.cmd` shims and npm launchers are not accepted on Windows. The source
   adapter currently accepts version 2.1.268+ in major version 2; this is a
   capability floor, not a tested version list.
3. Use **Check installed Claude and sign-in** in the diagnostic section.
   Record the detected version. It runs only `--version` and `auth status`,
   not inference. Log in using `claude auth login` in the provider's native
   terminal/browser flow, then check again. ReadyState never receives login
   credentials. Only the native `claude.ai` authentication method qualifies
   for this evaluation; API keys/helpers, token env and third-party routing
   are refused, not substituted.
4. Once permission and final-head review gates clear, the local operator may
   separately enable `READYSTATE_CLAUDE_CLI_EVALUATION=1` and restart. Leave it
   unset otherwise. This may consume subscription allowance or account-
   configured extra usage; no no-cost claim is made.
5. In ReadyState, create a new fictional diagnostic, select a requested model,
   inspect the fixed fictional request/acknowledgement, and explicitly choose
   **Send fictional diagnostic to Claude**. No pairing/MCP/Claude Desktop chat
   is needed. The native CLI receives only fixed ReadyState fixture content,
   plus its own native system context. Record the validated saved event,
   runtime version, requested model and separately CLI-reported model evidence
   or unavailable status. Refresh/restart must retain these.
6. Cancel during an outstanding request. Inspect saved state before retrying:
   cancellation cannot undo committed writes or provider consumption.
   Verify expired authentication, usage limits, unavailable models, denied
   permissions, malformed output, timeout and missing runtime produce explicit
   errors without silent model changes, API fallback or automatic retries.
7. Restart after acceptance and retry the same diagnostic: it must display the
   accepted event without a new inference call. Restart before acceptance:
   progress must remain, with any further call explicitly authorized. Do not
   claim exactly-once provider execution across crashes.

Live evidence remains **pending** for runtime version, native sign-in,
requested/returned model, fixed response, cancellation, expired auth, quota,
permission denial, restart and Windows/Linux runtime behavior. Automated tests
use a fake runner and owned Node subprocesses, not Claude inference. The
deterministic fixture does not test exercise or debrief quality.

### Owned CLI process cleanup

Each invocation owns a POSIX process group or a Windows kill-on-close Job
Object. Windows requires Windows 10+ and Windows PowerShell/.NET Framework;
the native executable is created atomically in the job, without shell command
interpolation. Job setup failure refuses execution rather than launching an
unowned CLI. Cancellation, the 90-second deadline, excessive output and input
failure terminate that owned scope. Leader exit also terminates descendants,
including those still holding inherited stdout/stderr. A one-second cleanup
deadline destroys local streams and settles the request even if stream close
never arrives, allowing the running-diagnostic guard to clear. This is not a
claim that POSIX processes deliberately escaping their group are contained.

Run the no-model regressions with:

```powershell
npm test -- lib/claude-cli.test.ts lib/claude-process-tree.test.ts lib/claude-process-settlement.test.ts lib/local-connection-http.test.ts
```

The process-tree fixture holds either stdout or stderr open in a child and
grandchild, and verifies cancellation, timeout and leader exit settle within
a bound with the owned processes no longer running.

### Reproducible Windows in-app fixture

The repo-owned browser/native-executable fixture runs the production ReadyState
UI against a compiled, fictional CLI and real local SQLite. From the repository
root, with dependencies restored and a production build:

```powershell
npm run build
node scripts\testing\claude-in-app\run.mjs
```

Requires Windows, Node 24, Microsoft Edge and .NET Framework `csc.exe`. It makes
no network downloads and uses no browser profile or credentials. Playwright
Core is a pinned development dependency. The harness stages its own build,
fictional executable, private database and browser profile in one uniquely
named directory under `scripts\testing\claude-in-app`; cleanup removes only
that directory. It verifies usage-limit refusal, process cancellation,
explicit retry, one accepted SQLite event, model-evidence display and server
restart/re-display, with zero model calls and blocked external browser requests.
This harness has only been verified on Windows; it does not qualify Linux or
the official Claude runtime.

The existing MCP source diagnostic below remains intact but is no longer the
primary qualification target.

Status: **source diagnostic implemented; live Claude Desktop qualification pending**.
This is not an installable extension, scenario/debrief qualification or release
authorization. Corrections for the prerequisite local bridge's (#39) returned
cross-tab privacy and storage/recovery findings are pushed for re-review;
they are not yet cleared. Do not use personal
households, distribute this branch as a release or describe the connection as
qualified until those findings and final-head checks clear.

## What this diagnostic proves

The source connector exposes only:

| Tool | Purpose |
| --- | --- |
| `readystate_connection_status` | Check the scoped local bridge and saved test status; report model evidence as unavailable. |
| `readystate_get_diagnostic` | Obtain a repeatable task and its exact, fixed fictional acknowledgement. This reserves a local task, not a model call. |
| `readystate_submit_diagnostic` | Validate that acknowledgement, save one accepted event and return a receipt. |

It cannot run household scenarios, approve participant text, create sessions,
grant connections, select a Claude model or call a model provider. A changed
acknowledgement is invalid even if syntactically valid JSON. The fixture is a
transport test, not a test of reasoning or emergency advice. It uses the
existing scoped authentication, acceptance, SQLite and accepted-state display.
The adapter refuses non-diagnostic baselines and never returns their content
to the assistant. Use only a new synthetic session and private disposable data.

## Automated gate

From the diagnostic source branch with Node 24:

```powershell
npm ci
npm test -- scripts/claude/diagnostic.test.ts
npm run lint
npm run typecheck
npm run build
```

The tests exercise the SDK's real stdio discovery/calls against the real local
HTTP handler and SQLite service, without a model or Claude account. They cover
incorrect output, read-only permissions, expired/revoked/wrong-session tokens,
stale cancelled tasks, private one-use redemption, uncertain redemption,
lost write acknowledgement, reopen/reconnect and duplicate prevention.
Browser inspection separately confirms creating, pairing, refreshing and
displaying the accepted synthetic result. Neither gate certifies Claude host
compatibility. SDK v2 serves legacy stdio clients by default; live negotiation
with the installed Claude version must still be recorded.

## Source setup for controlled live qualification

Complete prerequisite review first. Use the exact same branch/version for the
server and connector. Follow the [local development setup](../architecture/claude-desktop.md#opt-in-development-setup-and-pairing),
with provider keys unset, `READYSTATE_LOCAL_ORIGIN=http://localhost:3000`, a new
private data directory outside the source/install roots, and a fresh random
owner setup code. Keep the port/origin stable. `npm start` supplies the actual
source/install protection roots. Do not delete a database to recover access.

1. Sign in to **Claude Desktop for Windows using Claude's normal interface**.
   ReadyState does not receive or inspect that session, subscription credential
   or password. Record app version, account/organization eligibility and any
   administrator restriction without recording account identifiers.
2. Select a model in Claude Desktop. Record its visible name as
   **user-observed, unverified**, not a model identity returned by ReadyState.
   ReadyState's model evidence is **unavailable** for this adapter; no assistant
   self-identification is requested or trusted.
3. Open `http://localhost:3000/connections` and unlock local setup. Choose
   **Create fictional connection diagnostic**. This explicitly saves only the
   fixed fixture; it does not read the household or call a model.
4. Copy the full **Diagnostic session ID** to local connector configuration.
   Select **Read context and submit generated turns**, then create a five-minute
   pairing code. Enter it only in local configuration, never the conversation.
5. In Claude's developer/local MCP configuration, add the source command shown
   below. Preserve unrelated entries. Use absolute paths to the installed Node
   24 executable and this source branch; do not launch through `npm` because
   its banner would pollute the stdio protocol.

```json
{
  "mcpServers": {
    "readystate-diagnostic": {
      "command": "C:\\absolute\\path\\to\\node.exe",
      "args": ["C:\\absolute\\path\\to\\ReadyState\\scripts\\claude\\diagnostic.mjs"],
      "env": {
        "READYSTATE_CONNECTOR_ORIGIN": "http://localhost:3000",
        "READYSTATE_CONNECTOR_SESSION_ID": "DIAGNOSTIC-SESSION-UUID",
        "READYSTATE_CONNECTOR_PAIRING_CODE": "FRESH-ONE-USE-PAIRING-CODE"
      }
    }
  }
}
```

This manual developer configuration contains a **secret**, not an example to
commit, export or include in screenshots/logs. This source diagnostic does not
provide an OS credential vault. The future `.mcpb` must use sensitive
configuration storage. Do not put an owner setup code or provider API key here.
The optional `READYSTATE_CONNECTOR_TOKEN` is a sensitive existing connector
token alternative for controlled automation, never a tool argument; set
exactly one credential type. No fixture script prints either secret.

6. Reconnect/restart the local MCP server in Claude. Inspect the connector/tool
   list. A green local process alone does not establish a working model call.
7. When separately ready to use the subscription, ask Claude:

   > Use only ReadyState's fictional connection diagnostic. Call
   > readystate_connection_status, then readystate_get_diagnostic. Submit the
   > exact returned taskId, expectedRevision and candidate using
   > readystate_submit_diagnostic. Do not include household facts or infer a
   > model name. Report the returned save receipt.

   Approve the tools through Claude's normal permissions flow. This step uses
   the Claude conversation and may consume subscription allowance; automated
   fixture tests do not perform it.
8. Back in ReadyState, press **Refresh accepted results**. Confirm
   **Diagnostic acknowledgement saved**, the exact fixed acknowledgement,
   one accepted event and model evidence **unavailable**. Reload/resume the
   same session and confirm it is retained.

## Checklist and evidence record

Record pass/fail/blocked, versions, date and sanitized receipts/errors for each
row. No credentials, account identifiers or household data in evidence.

| Area | Acceptance | Evidence status |
| --- | --- | --- |
| Sign-in | Claude's supported sign-in succeeds; signing out/expiry has recovery in Claude. ReadyState does not claim to detect it. | Live pending |
| Model selection | Picker location and visible name recorded as unverified. Missing/unavailable models are handled in Claude, not guessed by ReadyState. | Live pending |
| Discovery | All three diagnostic tools visible and status call succeeds with appropriate permission. | Real SDK stdio tested; Claude pending |
| Round trip | Exact fictional response validated, receipt returned, one accepted event displayed and retained after reload. | Automated local transport/storage and browser inspection; Claude pending |
| Permissions | Denied Claude tool permission prevents that tool's execution. Read-only pairing permits status, refuses task/submission explicitly. | Local read-only tested; Claude approval pending |
| Invalid output | Wrong candidate rejected, no event written; correct candidate then succeeds. | Automated tested; live pending |
| Disconnection | Server unavailable/cancellation returns an explicit error, never a success-shaped placeholder. | Automated error paths; live pending |
| Recovery | Retry original task/revision after uncertain save does not duplicate; reconnect/resume preserves accepted state. | Automated tested; Claude pending |
| Revocation/expiry | Revoked/expired/wrong-scope token denied; new pairing resumes the same fixture without deleting history. | Automated denial/reconnection; live pending |
| Transparency | Bridge status is separate from Claude account/model status. No unverifiable model label represented as verified. | Contract/display implemented; live inspection pending |

### Recovery rules

The pairing code is one-use and expires after five minutes. Its redeemed token
stays only in connector process memory unless the operator supplied a token
explicitly. A connector restart using a consumed code requires a **new code for
the same saved session**, updated local configuration and reconnection. A lost
redemption response also requires fresh pairing; it is not retried silently.
Revoke old connections. Never generate a new exercise just to retry a write.

An unconfirmed submission can be retried with its **original** task ID and
expected revision. The adapter derives a stable idempotency key from that task;
ReadyState returns the original receipt instead of appending another event.
After a restart requires fresh pairing, a newly authorized writer can recover
that same receipt (including its original accepted event ID) only when the
task, original revision, key and exact accepted candidate match the stored
event and receipt. Recovery does not write or advance the session. Read-only,
revoked and wrong-session connections cannot recover a write receipt.
Inspect status first. After cancellation/revocation invalidates work, retrieve
a fresh task rather than altering the old task or claiming it succeeded.
Completed diagnostic sessions do not expose another task.

For the live evidence record, include the installed Claude version, operating
system, selected model as observed in Claude's interface (unverified), each
tool's allow/deny behavior, sanitized saved receipt and display, and disconnect/
reconnect outcome. Do not fill these from automated-client evidence. Until
observed in the installed app, each remains **pending**; model evidence stays
**unavailable** when the integration cannot verify it.

## Exit gate and next connections

Claude is qualified only after the installed host passes all applicable rows,
prerequisite review/CI clears and failures are documented. Do not substitute
fixture success for sign-in/model availability/permission evidence. Full
scenario and checked-debrief testing follow separately. Apply this same
checklist independently to ChatGPT, Gemini and an Android runtime only after
documenting their supported authentication, tool interfaces and model evidence.
No shared subscription API or automatic cross-service fallback is assumed.

## Official references

- [Claude local MCP servers and desktop extensions](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
- [Claude model controls](https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings)
- [SDK stdio serving](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.md)
- [SDK legacy-client compatibility](https://ts.sdk.modelcontextprotocol.io/v2/serving/legacy-clients.md)
- [SDK client testing without a model](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-client.md)
