# Claude Desktop integration

Status: shared-foundation implementation only. **No installable Claude extension
or Claude-compatible release exists from this work yet.** No live Claude test has
been performed.

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
| 2: authoritative sessions | Durable local sessions, immutable approved baseline, revisions, phase/clock ownership, tasks and atomic/idempotent acceptance; shared web UI adapter | Restart recovery, concurrent submissions, stale tasks, wrong phase, duplicate-key mismatch and lost acknowledgement; reject without partial writes |
| 3: local connection | Scoped pairing/revocation, authenticated loopback service and local stdio MCP adapter | Unpaired/revoked access refused; no raw household, private ledger, credentials or retry settings in tools/errors/evidence; initial accepted turn with zero ReadyState model-provider requests |
| 4: full exercise | Approved participant responses, next-turn tasks, accepted UI updates, evidence retrieval and checked debrief/repair | Full fixture exercise through 72 hours; failed repair withheld; correct omissions and check-status wording; preserve ordinary API route |
| 5: Windows tester package | App plus `.mcpb`, setup/update/remove guide, checksums/notices/matching source and exact compatibility record | Extracted package startup, restart/revoke/update tests, offline MCP protocol tests, final code review and CI, then a clearly labeled installable tester release |
| 6: user qualification | User installs extension in their actual Claude Desktop account | Record app/client versions, Windows version, plan/policy availability, operations tested and limits; manually assess scenario/debrief quality separately |

Acceptance rules must explicitly define the final-turn time policy and supported
short crisis intervals before increment 2 changes progression behavior. An
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
  current stable server/client packages. No MCP SDK dependency is needed or
  introduced until the local adapter implementation.
