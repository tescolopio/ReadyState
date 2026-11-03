# Claude Desktop integration

Status: shared foundation, durable sessions and opt-in browser/pairing bridge. **No installable Claude extension
or Claude-compatible release exists from this work yet.** No live Claude test has
been performed.

The [connection qualification checklist](../testing/claude-connection-checklist.md)
adds a source-only stdio diagnostic using SDK v2. It exposes only status, a
fixed fictional acknowledgement task and validated submission; it cannot run
household scenarios or debriefs. The browser can explicitly create and display
this synthetic session without reading a household or calling a model.
Model selection belongs to Claude; this adapter reports model evidence as
unavailable. The local bridge's returned findings have correction commits
awaiting re-review and remain blockers,
not waived by the diagnostic. Live account/model/tool-permission qualification
and an installable Windows extension remain pending.

## Confirmed first target

The user selected **Claude Desktop on Windows**, with **ReadyState handling
setup, privacy review and results, and a Claude conversation generating turns**.
Other assistant platforms, Claude web/mobile and remote connectors are later
compatibility projects, not implied support.

An MCP connection lets Claude use ReadyState tools in the user's conversation.
It does not turn a Claude subscription into an API credential. ReadyState will
not read Claude sign-in tokens, automate its private endpoints or ask for a
subscription password. Claude usage limits and organization policies still
apply. The existing API-provider path remains available separately.

## Intended first installable experience

1. Install the local ReadyState application and an accompanying `.mcpb`
   extension in Claude Desktop. Installation must not require a separate model
   API key or a separately installed Node runtime.
2. Explicitly pair the extension with this local ReadyState installation.
   The pairing grants access only to selected exercise sessions, with separate
   read/write permissions and a visible revoke control.
3. In ReadyState, choose a household/scenario and review the masked briefing.
   Only a deliberately approved snapshot becomes available to the extension.
   Later household edits do not rewrite that session's baseline.
4. Ask Claude to continue that ReadyState exercise. It retrieves a permitted
   generation task, generates a candidate and submits it for validation.
   ReadyState records and displays only an accepted result.
5. Enter decisions in ReadyState and review what will be released. Then ask
   Claude to continue. Repeat through the exercise and checked debrief.
6. Close/restart either app and resume the same accepted exercise without
   duplicated turns or automatic model calls.

A ReadyState button must not claim to wake Claude automatically. The participant
initiates generation in Claude. Text typed directly into Claude has already
reached that provider; ReadyState cannot retroactively mask it.

## Baseline audit

Source pinned before this increment:
`0a5ef43eebb0eb346cff5865ba247e7d606a1799` (merged #32).
Pending #33/#34/#35 and the native-preview publication controls are separate.
Their review and release gates are not waived by this project.

| Existing surface | Observed behavior | Foundation treatment |
| --- | --- | --- |
| [Exercise contracts](../../lib/ttx.ts) | Zod shapes, AI SDK tool echoes, UI messages, phase derivation and condensed briefing | Move domain schemas/types into [exercise-contracts](../../lib/exercise-contracts.ts); keep public re-exports for callers |
| [API route](../../app/api/ttx/route.ts) | API model selection, streaming, request deadline, schema retry and one debrief repair | Keep execution, credentials, budgets and counters in this adapter |
| Controller instructions | Safety rules, privacy placeholders, continuity, Hour 0, nominal 6-12-hour progression, 72-hour end | Extract a [versioned prompt catalog](../../lib/exercise-prompts.ts); keep forced API-tool delivery wording in the API adapter |
| Briefing | Baseline, older condensed inject/action log, latest outcome/inject/alerts, pending action | Extract a [transport-independent formatter](../../lib/exercise-context.ts); API message parsing still belongs to the existing adapter |
| [Debrief checks](../../lib/debrief-checks.ts) and [story facts](../../lib/story-facts.ts) | Deterministic limited-coverage checks, known invented-equipment defects and story briefing | Share [debrief context preparation](../../lib/exercise-debrief.ts); retain existing repair, rejection and omission behavior |
| [Exercise session](../../lib/exercise-session.ts) | Browser-memory Chat/session, not an authoritative durable task service | Do not pretend this is already the MCP repository |
| [Masking](../../utils/obfuscator.ts) and [outgoing review](../../lib/outgoing-review.ts) | Client-side masking, editable approval, send-time checks | Preserve this boundary; a formatter is not a sanitizer or authorization service |
| Local packaging | Native Windows/Linux app archives, not a Claude extension | Add a separately verified extension artifact later; do not relabel an app ZIP as Claude-ready |

Schema, prompt and compact-context versions begin at `1`. The schema extraction
preserves the current wire format and descriptions. Existing schemas are not yet
an acceptance policy: some bounds/cardinalities remain instructions, and Zod's
current object behavior does not reject every unknown field. Do not equate
parsing with valid progression, safety or factual correctness.

The compact formatter also retains the existing information-loss limitations:
older narratives/alerts are not all repeated. MCP must retain a full accepted
event log and expose permitted evidence retrieval, not rely on this summary as
the only source of truth. This increment does not expand G6 compression work.

## Implementation sequence and gates

| Increment | Deliverable | Required evidence before moving on |
| --- | --- | --- |
| 1: shared foundation (this change) | Domain schemas/types, prompt catalog, briefing and debrief-context extraction; no connector endpoint | Exact pre-extraction prompt/schema fingerprints; API regression checks; eight fictional-household context parity/privacy checks; no provider calls |
| 2: authoritative sessions (internal implementation) | SQLite sessions, immutable approved baseline, revisions, scoped grants, clock policy, version-bound turn tasks, atomic/idempotent acceptance, accepted-state-to-UI-message mapping | Service close/reopen, competing independent database connections, stale tasks, wrong phase, duplicate-key mismatch, lost acknowledgement and forced mid-commit failure; reject without partial writes. Browser/API wiring still pending |
| 3: local connection (browser/HTTP and source diagnostic implemented) | Opt-in owner setup, scoped one-use pairing/revocation, authenticated loopback service, separate browser session screen and fictional stdio diagnostic; full scenario adapter remains ahead | Unpaired/revoked access refused; no raw household, private ledger, credentials or retry settings in tool responses; fixture turn refresh/restart without ReadyState model-provider requests; real Claude remains unverified |
| 4: full exercise | Approved participant responses, next-turn tasks, accepted UI updates, evidence retrieval and checked debrief/repair | Full fixture exercise through 72 hours; failed repair withheld; correct omissions and check-status wording; preserve ordinary API route |
| 5: Windows tester package | App plus `.mcpb`, setup/update/remove guide, checksums/notices/matching source and exact compatibility record | Extracted package startup, restart/revoke/update tests, offline MCP protocol tests, final code review and CI, then a clearly labeled installable tester release |
| 6: user qualification | User installs extension in their actual Claude Desktop account | Record app/client versions, Windows version, plan/policy availability, operations tested and limits; manually assess scenario/debrief quality separately |

The user confirmed the following turn policy for the new session service:

- Initial turn: exactly Hour 0, null feedback, no suggested actions, ongoing.
- Later turns: advance normally by 6-12 hours, never backward or above Hour 72.
- A shorter positive step is permitted for a crisis only when the local owner
  has approved a short-step reason before task issuance. This authorization is
  stored with the accepted event's task; an assistant cannot grant it.
- The final interval may be shorter than six hours when it ends exactly at 72.
  Overshoots are rejected, not silently clamped. Readable time must equal
  `Hour ${hours_elapsed}`. Only Hour 72 is complete.
- Ongoing turns require 3-4 response choices, completed turns none; at most
  two suggested actions. Post-initial turns require feedback.

[Turn validation](../../lib/exercise-turn-validation.ts) is explicit, bounded and
rejects unknown structural fields. This is a new acceptance-policy version,
not a change to the original wire-schema/prompt versions.
The existing API path remains behavior-compatible and is **not yet routed
through this service or these stricter checks**. API-to-service migration and
policy parity are release gates, not already completed work. An
already accepted report ends generation. Session authorization, expected
revision, bounded candidate shape, clock agreement and phase/cardinality checks
must run before atomic commit. Deterministic validation is not safety
certification; do not install the rejected experimental AI judge.

### Connection and storage boundary

The intended local split is a thin stdio extension using Claude Desktop's Node
runtime, connected to the bundled ReadyState app's authenticated loopback
service. The application owns the durable exercise repository; the extension
does not independently edit browser localStorage or maintain a second history.
Persistence and locking must be verified before exposing mutation tools.

The internal [local exercise service](../../lib/local-exercise-service.ts) now
owns one exercise SQLite database selected by explicit local configuration. It uses Node
24's built-in `node:sqlite` (still marked experimental in the pinned runtime),
so no native npm database dependency or separate database installer is added.
Ordinary startup still leaves it disabled. Opted-in connection requests open
and close the database per operation. Automatic installation paths, Windows ACL
provisioning, launcher owner-setup automation and extracted-package qualification
remain release gates.

State includes the exact approved baseline text, approved participant response
references, complete accepted events and their task versions/context hashes.
Reads validate stored progression; unknown database formats, malformed state
and missing initialized tables are refused rather than reset. Transactional
receipts support retry after a lost acknowledgement. Reusing an idempotency
key for a different command, content or revision is refused. Repeating creation
with the same owner/approval reference returns its original creation receipt;
fetch current state separately for its latest revision.

Per-session read/write grants are enforced by the internal service. Only the
local owner can grant/revoke access or supply approved baseline/response text.
Revocation invalidates outstanding work without deleting accepted history.
Principal IDs are identifiers, **not authentication credentials**. The
[HTTP boundary](../../lib/local-connection-http.ts) authenticates owner cookies
or connector tokens before supplying principals. Connector operations are an
allowlist: redeem code, read state, obtain task and submit turn. They cannot
approve responses, create sessions or grant access.

Turn-task retrieval is repeatable and has no wall-clock expiry in this
user-paced implementation. Cancellation is explicit, increments the revision
and retains a pending approved response for another task. A disconnected
assistant can retrieve its unchanged task after the service restarts. A stale
version requires deliberate cancellation/reissue, never silent regeneration.

[The rendering adapter](../../lib/local-exercise-view.ts) maps accepted service
events to existing UI message shapes without accepting replacement transcripts.
It is a pure adapter; the ordinary API exercise page still uses its original
session. The opt-in [connection screen](../../app/(app)/connections/page.tsx)
instead reads accepted service state on explicit **Refresh accepted results**,
shows approved masked text, and resumes saved sessions. Briefings/responses
reuse existing masking, editing, tag checks and send-time re-review. Back sends
nothing. No model request is made by this screen. An unconfirmed response retry
first reconciles its approval reference against pending and accepted responses
under the session lock. Already committed text is not retransmitted. Otherwise
it reloads current private context and checks the server revision; changed text,
mappings or rules require another explicit review. Only an unchanged retry uses
the original approved text, reference and idempotency key from this tab.
Unreviewed typing/previews/retries do not survive tab closure; refresh saved
state before repeating an operation with an uncertain result.

Each local session has its own browser-private masking context, associated with
its approved briefing reference. Its original private terms and tag mappings
survive reloads without modifying the ordinary API exercise's global ledger.
Changing the current household does not change an older session's privacy
context. The context is saved before the approved text can leave the browser;
blocked/full storage prevents transmission. Missing or corrupt context makes a
saved session read-only rather than substituting another household's terms.
Refresh can retry association from an interrupted creation's private draft.
Otherwise create a new session and review its briefing again. These mappings
contain private information, remain unencrypted in this browser, and are not
stored in the exercise database.
Response approval uses an exclusive per-session Web Lock across tabs, reloads
the current private context and checks the server revision before saving new
mappings or transmitting. Changed mappings/rules require a rebuilt review;
stale exercise state is refreshed without overwriting mappings. Browsers
without Web Locks fail closed. Current Settings Always Mask terms are combined
with the session's original terms both when opening and approving a review.
Selecting an additional mask in this local review applies only to this session,
stays in tab memory until Send and does not change Settings or other sessions.
Back discards these unapproved rules. Private-draft recovery reads do not
promote or overwrite session mappings; the first approved response saves the
session context under its lock and removes the creation draft.
The review editor and open mask/Back confirmation controls are disabled
throughout asynchronous approval, including waits for the lock and server
state, so the approved preview cannot be changed while submission is pending.

Debrief-task acceptance/repair, evidence-tool pagination, ordinary API migration,
automatic accepted-state notifications and the household-scenario MCP adapter remain subsequent
increments. The optional short-step control sends only a displayed fixed
statement; it is not an unreviewed free-text channel.

This database contains personal exercise information even when masked and is
**not encrypted** by this implementation. It must remain outside the
installation directory so updates do not overwrite it. Before release, include
it in explicit backup/restore/delete behavior (coordinating with #33), test
upgrades with populated databases, and document its location and permissions.
An app/database copy is not automatically a consistent full backup while open.

Household/settings browser storage remains local. The service receives only
explicitly approved session snapshots/responses, never bulk access to saved
households or full backups. A baseline/response tool consumes an approved
reference, not arbitrary assistant-supplied text labeled "approved".
Use server-side session permission checks, not caller assertions or MCP hints.
Retain same-origin browser protection; pairing is not a reason to enable
wildcard CORS or public unauthenticated access.

Loopback binding alone is not authorization. Extension credentials belong in
Claude's sensitive configuration storage; do not include them in logs, exported
exercise reports or example configuration. Revoke a connection without deleting
the household or accepted exercise. An extension crash must not stop ordinary
ReadyState assessment or corrupt sessions.

### Opt-in development setup and pairing

This is a **source-development procedure**, not the promised Windows installer.
Do not ask testers to configure an imaginary Claude extension: no `.mcpb` exists
yet. The connector endpoint currently supports deterministic protocol tests only.

The bridge is off unless `READYSTATE_LOCAL_CONNECTIONS=1`. It refuses hosted
mode, Vercel deployments and private-trial-password deployments. Configure an
exact HTTP loopback origin, a private absolute data directory outside the
installation, and a fresh random 32-byte lowercase-hex owner setup code.
Do not put the directory in a synced/shared folder, repository or app archive.
New POSIX directories use mode 0700 and existing broadly accessible POSIX
directories are refused. Windows currently inherits the selected directory's
ACL: the operator must verify it is private; automatic ACL setup is not yet
qualified. Same-user malware, browser extensions, compromised app scripts and
other local processes with access to the owner's environment/files are outside
this local trust boundary. HTTP cookies are not port-isolated; do not treat this
prototype as isolation from hostile software on the same machine.

Example in a private PowerShell development session with Node 24 available:

```powershell
$env:READYSTATE_LOCAL_CONNECTIONS = "1"
$env:READYSTATE_LOCAL_ORIGIN = "http://localhost:3000"
$env:READYSTATE_LOCAL_DATA_DIR = Join-Path $env:LOCALAPPDATA "ReadyState-Claude-Development"
$env:READYSTATE_LOCAL_OWNER_CODE = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
npm run build
npm start
```

In another trusted local window, open the exact configured origin's
`/connections` page. Enter the generated setup code locally, never in chat or a
model prompt; do not print it into shared logs. An operator can privately copy
it from the development session using their normal secret-handling workflow.
Once setup is unlocked:

1. Review the current household's complete masked briefing. Edit or go Back as
   needed; only **Send this** creates a durable session.
2. Select read-only approved-state access or read/context/turn-submission access
   for that exercise, then create a pairing code. Read-only is the default.
3. Give this one-use, five-minute code only to the local connector's
   configuration, **not the assistant conversation**. The future extension will
   provide this configuration UI. Redemption returns a session-bound credential
   lasting 30 days. It does not expose a provider API key.
4. Ask the assistant to continue only once a supported extension exists.
   Until then, fixture tools can retrieve/submit a candidate and the browser's
   Refresh shows only accepted results. A ReadyState button does not wake Claude.
5. Review each participant response before release. Cancel an outstanding task
   to invalidate it while preserving a pending approved response. Withdraw an
   approved response to remove it from future context and invalidate its task
   before reviewing a replacement. Withdrawal cannot recall information a
   connector or Claude has already retrieved.
6. Revoke a code/connection to deny future requests and invalidate outstanding
   work without deleting accepted history. Locking setup ends only the owner
   browser session, not independently paired connections.

The owner code is single-use. The resulting cookie is HttpOnly, SameSite=Strict,
scoped to the browser endpoint and expires after 12 hours. For a lost/expired
owner session, stop the app, configure a new random code and restart; unlocking
with it invalidates older owner cookies but preserves owner/session identity.
Do **not** delete either database as a login-recovery shortcut.
If only one of the two database files exists, startup refuses to create its
missing counterpart. Inspect/restore the complete local data pair rather than
silently replacing owner identity or hiding previously saved sessions.
Existing databases must contain the expected schema, metadata and owner row;
empty or partially initialized files are refused without initializing them.
Initialization is reserved for an entirely new pair. The local launcher passes
the real source/install roots to the standalone process; data-path checks
resolve junctions/symlinks and missing descendants before directory creation.
Do not invoke a standalone server directly without supplying the absolute
`READYSTATE_LOCAL_SOURCE_ROOT` and `READYSTATE_LOCAL_INSTALL_ROOT` protection
roots. A standalone server's changed working directory is not the install root.
Before opening either store, database and SQLite sidecar paths must be regular
files with exactly one hard link and no symbolic link. Directory privacy alone
cannot protect data reachable through another file path. Existing stores are
opened with SQLite `mode=rw` (never create) for validation, permitting hot
rollback-journal recovery after a killed process without reinitializing data.
This recovery can restore uncommitted pages; it is not a storage reset.

Browser requests must have the exact configured Host and Origin; cross-site
fetch metadata is refused. Next canonicalizes internal loopback Request URLs,
so those may use a loopback alias with the same scheme/port; the external Host
and browser Origin checks remain exact. Connector requests require bearer
credentials and refuse any Origin/cookies; an owner cookie cannot authenticate
the connector endpoint or vice versa. No wildcard CORS is enabled.

The separate `connection-credentials.sqlite` contains only credential hashes,
expiry, consumed-code markers, principal/session/permission metadata and stable
owner identity. Pairing codes/tokens are generated cryptographically and returned
only once; raw credentials are not persisted. Revocation denies the credential
before grant cleanup; a cleanup failure is explicit and can be retried.
Repeating a revocation after another tab already revoked the connection
succeeds without logging the owner out.
The source diagnostic supports authenticated matching-receipt recovery after
fresh pairing: only a writer for that same exercise can recover the original
receipt by its accepted task/revision/key/candidate. This read does not alter
history, grant access or repeat acceptance.
Keep this credential database out of exercise exports/backups intended for
sharing. Safe full backup/delete/restore coordination for both stores, including
connection revocation after restoration, is still a pre-release requirement.

### Verification boundaries

The automated transport tests exercise real local SQLite stores and synthetic
credentials: cross-origin/Host refusal, permission separation, code/token
expiry, one-use redemption, hash-only persistence, close/reopen, setup-code
recovery, revocation (including cleanup failure), bounded input and disabled
web/trial/hosted routes. They prohibit provider fetches.

The installed Edge walkthrough uses an isolated key-free production server and
browser profile. It covers explicit household/response approval and cancellation,
private-name masking, accepted fixture turns, lost-acknowledgement retry,
stale-response refresh, task cancellation, 1280/390/320px layouts, keyboard
focus, reload, actual server process restart and connection revocation. External
and model requests are intercepted/blocked; none are attempted in the passing
walkthrough, and no browser runtime errors are observed.
The review-fix walkthrough also covers approved-response withdrawal and
replacement, invalidated-task refusal, masking after changing the current
household, missing/corrupt privacy context, quota refusal before transmission,
pairing-code hiding on session creation/switching, and repeated revocation
without owner logout. Storage regressions separately exercise empty/incomplete
stores, missing owners and source/install-tree confinement including links.
Returned-review regressions additionally cover actual killed-process journals
for both stores, hard-linked databases/sidecars, missing-file non-creation,
grant-cleanup retry after reopen without invalidating another connection's task,
current Settings mask changes, session-only unsaved selection rules and
two-tab stale approval without overwriting accepted mappings.

This is **interface inspection**, not human usability or live Claude testing.
Physical phones, Safari, Firefox, Windows installer ACL provisioning, extension
installation/credential storage, actual Claude subscription compatibility and
model/debrief quality remain unverified. A passing build is not extracted
Claude-package evidence.

## Release boundary and readiness notice

The existing authorized `v0.1.0-preview.1` native tester release is not a promise
of Claude compatibility. Do not silently include this unfinished integration
or expand that release's scope. A Claude tester release needs its own explicit
contents/version decision after the above gates clear.

The first readiness handoff must provide a real release link, exact supported
Windows/Claude Desktop setup, app and `.mcpb` files, checksums, privacy/permissions,
update/revoke/remove instructions, and a fictional-household test script.
Label it ready for **user installation testing**, not already Claude-qualified.
The user's subscription test is the final client-compatibility check; internal
mock tests must not be reported as a live Claude run.

No live model calls, subscription login, model downloads, publication, Vercel
configuration changes or public MCP hosting are part of this foundation.

## Official compatibility sources

Checked 2026-11-02; installation labels and account policies may change.

- [Claude local MCP servers and desktop extensions](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop):
  custom `.mcpb` installation, connection status/logs, built-in Node runtime,
  sensitive configuration storage and organization controls. Custom/direct
  extensions require manual update; directory publication is not needed for a
  tester artifact.
- [MCP Bundles](https://github.com/anthropics/mcpb):
  extension manifest and packaging tooling. Validate the final manifest and
  runtime compatibility against the client actually being tested.
- [MCP transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports):
  local client-launched stdio versus remote Streamable HTTP. Earlier protocol
  compatibility must be tested, not inferred from SDK version alone.
- [TypeScript SDK v2](https://github.com/modelcontextprotocol/typescript-sdk):
  current stable server/client packages. The source diagnostic uses pinned
  server/client v2 dependencies; that does not qualify the installed Claude
  host or its bundled runtime.
