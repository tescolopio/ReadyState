# ReadyState
ReadyState is a dynamic, AI-powered Tabletop Exercise (TTX) simulator designed for personal and household emergency preparedness.

Run it yourself with your own model API keys (or a fully local model through Ollama). For a private online trial, follow the [Vercel trial guide](docs/deployment/vercel-trial.md). The paid hosted service is not implemented yet; see [Deployment modes](docs/architecture/deployment-modes.md).

For Windows/Linux native, Docker and bundled-runtime portable/per-user installs,
see [Local installation](docs/deployment/local-installation.md). Ollama support
is experimental; no model is included with ReadyState.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · Vercel AI SDK (`ai`, `@ai-sdk/react`, `@ai-sdk/openai`, `@ai-sdk/google`) · Zod · Zustand · compromise · lucide-react · Dexie · Supabase (hosted service).

## Self-hosting

**Docker**

```bash
docker compose up -d     # http://localhost:3000
```

**Node 24**

```bash
conda env create -f environment.yml   # optional: Node 24 LTS (or -p <path>)
conda activate readystate
npm ci
cp .env.example .env.local            # optional: set provider keys here
npm run dev                           # or: npm run build && npm start
```

Open http://localhost:3000 for the website, or http://localhost:3000/journal for the app. **Household assessment needs no provider or API key.** For optional AI exercises, pick a provider and paste your API key in the app's **Settings**, or set keys in `.env.local`. Supported providers are Groq (default), Google Gemini, Cerebras, OpenRouter, Ollama (local, no key) and any OpenAI-compatible endpoint. Keep self-hosted instances on localhost or a trusted network; see the [security notes](docs/architecture/deployment-modes.md#security-notes).

## Local household assessment

Open **Assessment** (`/assessment`), add a short household profile, and choose
**See assessment** whenever you are ready. Add optional People, Pets, Home,
Health needs and Supplies details later. Results distinguish confirmed gaps,
unassessed answers, planning guidance, scenario concerns and recorded resources.
Expand **Based on your answers** for the facts, rule and sources, and save useful
actions to the shared **Action plan**. Return to update answers or mark actions
in progress/done. Saved actions show their source/date and remain earlier
choices, not live deficiencies: changing answers does not silently rewrite,
remove or complete them. Review your current assessment before deciding which
to keep or remove. **Practice with this household** is optional.

Zero and **I don't have this** are explicit answers, not the same as unknown,
skipped or **Prefer not to say**. Old unchecked items become unassessed, not
missing. **Not applicable** is offered only for formula when there is no formula
feeding. A partial profile can produce useful results; there is no overall
preparedness score. Rules remain drafts pending content review.

The assessment uses the existing household, rules and plan, entirely in the
browser. It makes no model calls. Local storage is not encrypted; use the
household Review step's **Delete it** to clear the profile, and manage saved
actions separately in the plan. Optional exercises retain review-before-send;
explicitly reported supply absences are included as labeled household facts
in the reviewable briefing, even when no rule checks that item. Local
answer-status metadata and negative health-need answers are not added to
provider summaries. Dedicated
communication and evacuation planning questions are deferred to a separate
increment.

**Simple / Guided:** Switch between the quick-entry assessment and the Guided
prototype on Assessment without losing household answers or chosen actions.
Guided currently covers water: an optional labeled-container helper, explicit
uncertainty choices, transparent existing-rule explanations and saved next
steps. Helper drafts are not recorded supplies until confirmed. Topic progress
describes review, never readiness. Other topics still use Simple forms.
See the [shared scope, visual style and asset register](docs/product/guided-assessment.md).

### Save and load household data

On **Assessment**, open **Save or load household and plan**:

- **Save a named copy** keeps an independent snapshot in this browser. Give
  each snapshot a different name; existing copies are not silently overwritten.
- **Export current household and plan** downloads a versioned JSON save file.
  You can also export an earlier named copy without loading it first.
- **Load a save file** or **Load [name]** previews the saved date and household/
  action counts. **Replace household and plan** explicitly replaces both,
  rather than merging; **Cancel load** changes nothing. Export or name your
  current work first if you want to keep it.
- Deleting a named copy requires confirmation and leaves the working household,
  chosen actions and previously downloaded files alone.

Saves contain the complete household (including local names, practical health
needs, notes and unknown/skipped/withheld answer states) and chosen action text,
source, dates and status. **Files and browser saves are not encrypted.** Keep
them private and do not enter credentials in household notes or plan text.
Provider settings/keys, exercise history and the in-memory masking ledger are
not part of the save format. Save/load does not contact a server or model.

Named copies and automatic working data are tied to the browser and site
address, including its port. They survive restarting ReadyState, but not
clearing browser storage. Export files for backups or to move to a new browser,
installation or local address. Deleting the working profile does not delete
named copies or downloaded files; remove those separately if needed.

Imports support ReadyState save format **version 1**, up to **2 MiB**. Invalid,
conflicting or unsupported data is rejected before loading; old raw browser
storage dumps are not this portable format. Browser quota/read/write errors are
shown explicitly. If a normal storage write fails during restore, the prior
household/plan are restored before reporting failure; an unrecoverable storage
failure is reported rather than claiming success.

### Full encrypted backups and local history

For **all ReadyState application data**, use **Settings → Full encrypted
backups**, not the household-only JSON export. Full backups include:

- Household answers and assessment stage, chosen plan actions/statuses, named
  household snapshots and appearance.
- A dated report of the current nonempty assessment and earlier deliberately
  saved reports, including their original explanations, supporting answers,
  next steps and source references.
- Saved exercise/debrief snapshots plus the current exercise and unsent response
  draft. Model-generated material remains unverified, historical material.
- **Browser-saved provider settings and API keys**, Always Mask names and private
  tag mappings needed to display the saved exercise.

Full backups use password-derived AES-256-GCM encryption (PBKDF2-SHA256,
600,000 iterations, fresh random salt and IV). Use a unique password/passphrase
of at least 12 characters. **There is no password recovery.** Save to an
encrypted file or a named encrypted browser copy; named copies can be exported
without unlocking them. Names/dates of browser copies are not secret.

Enter the password to unlock a file or named backup, inspect its counts/date,
then explicitly **Replace all and reload**, or cancel without changing working
data. Restore replaces, rather than merges, the listed application data and
reloads the app to discard stale forms, send approvals and retry credentials.
It preserves unrelated browser data and existing encrypted full backup copies.
Avoid simultaneous edits/restores in other tabs.

This is an application-data backup, not a backup of the installation or server:
server/environment keys, authentication cookies, deployment configuration,
model downloads, eval diagnostics/repair drafts and captured retry settings are
excluded. Unsaved settings form edits and outgoing review/approval state are
also excluded. Backup containers are not recursively copied into new backups.
The current browser provider key is intentionally included in the encrypted
settings section, never in the saved conversation metadata.

The assessment remembers its current topic between visits/reloads.
**Save dated assessment** keeps a historical report in **Journal**;
**Journal → Save current exercise locally** keeps a dated exercise, debrief
and response-draft snapshot. A saved resume point is loaded once after reload;
later exercise changes require another explicit save. Older snapshots remain
available to open deliberately. Starting over clears the saved resume point,
not the history. New responses still need S2 review; restoring never calls a
model and never restores permission to retry a previous request.

Encryption protects full backup copies, **not live browser storage**.
Working profiles, saved keys and deliberately saved local history are still
readable by someone with browser access. History can include names and private
tag mappings. Delete history, named household copies, encrypted copies and
downloaded files separately when removing personal data.

Version-1 full backups support up to **20 MiB of decrypted data** in an encrypted
JSON file up to **30 MiB**. Invalid/unsupported data, wrong passwords, tampering
and quota/storage errors are reported explicitly; no unencrypted fallback is
used. Ordinary write failures roll back prior writes, but browser storage is
not a crash-atomic transaction. Web Crypto requires HTTPS or localhost; plain
HTTP on a LAN address is not supported for encrypted backups. Keep a portable
backup before replacing data.

Scripts: `npm run dev`, `npm run build`, `npm start` (loopback standalone production launcher), `npm run package:local`, `npm run lint`, `npm run typecheck`, `npm test` (Vitest). CI (`.github/workflows/ci.yml`) runs application checks and Docker smoke tests on every PR.

## Architecture

| Path | Purpose |
| --- | --- |
| `store/usePrivacyStore.ts` | In-memory Zustand ledger (`entityMap`: tag → real value) and the always-mask name list. |
| `lib/household.ts` / `store/useHouseholdStore.ts` | Structured household profile from the setup wizard (`components/household-wizard.tsx`), saved in this browser only. `describeHousehold` turns it into the attribute summary the engine sees: needs as functional tags, no names or medication names, and skipped sections marked unknown. |
| `store/useSettingsStore.ts` | Self-hosted provider choice and API key, persisted to this browser's `localStorage`. |
| `lib/full-backups.ts` / `lib/full-backup-state.ts` | Strict full-data contract, local password encryption and confirmed, rollback-protected restore. No server/environment keys or transport approvals. |
| `lib/local-records.ts` / `store/useLocalRecordsStore.ts` | Assessment progress, dated assessment explanations and explicitly saved exercise/debrief snapshots. Live privacy state can be preserved by explicit local saves; it is not automatically logged. |
| `utils/obfuscator.ts` | `maskInput` replaces people, pets, places, street addresses, postcodes, phones, emails, URLs and ID numbers with tags (`[Person 1]`, `[Pet 1]`, `[Phone 1]`, …) using patterns, context rules ("my wife Priya", "our dog Max"), compromise NLP and the user's always-mask list. `unmaskOutput` restores them. Tested against `utils/masking-corpus.ts`. |
| `lib/ttx.ts` | Zod schemas for the `generate_turn` and `after_action_report` tools, `deriveTtxState` (the TTX state machine) and `buildExercisePrompt` (compact per-call briefing). |
| `lib/providers.ts` | Provider presets and `resolveModel`, which picks the model per request from browser settings or server env. |
| `lib/config.ts` / `lib/hosted.ts` | `READYSTATE_MODE` and the hosted-service integration points (auth, quota, usage metering). |
| `app/api/ttx/route.ts` | `streamText` route that **forces** the tool matching the current phase, so every response is structured JSON. |
| `app/api/config/route.ts` | Key-free description of the server's setup (mode, providers) for the UI. |
| `app/page.tsx` | The public website. |
| `app/(app)/` | The app, inside a shared navigation shell (`components/app-shell.tsx`): Journal, Exercises, the active exercise (`exercise/page.tsx`: response options, feedback, keeping steps in your plan, the decision path and the debrief), My household, local Assessment, Action plan and Settings. |
| `components/ui/*` | Minimal shadcn/ui-compatible `Button`, `Input`, `Card`, `ScrollArea`, `Badge`. Replace with the real ones via `npx shadcn@latest add button input scroll-area card badge --overwrite`. |
| `supabase/migrations/*` | `sim_logs`, `subscriptions` and `usage_events` with Row Level Security. |

Further reading:

- [Design system](docs/product/design-system.md): the two visual treatments, tokens, contrast and component rules.
- [Product and experience design brief](docs/product/design-brief.md): personas, the journal experience, visual identity, the family model and requirements.
- [Modern design treatment](docs/product/design-treatment-modern.md): Style B, the alternative visual treatment for the A/B test.
- [Work breakdown](docs/roadmap/work-breakdown.md): the roadmap by team, traced to the brief.
- [Local test checklist](docs/testing/local-test.md): run it yourself and check it by hand in a browser.
- [Deployment modes](docs/architecture/deployment-modes.md): self-hosted vs hosted, providers, desktop and mobile plans.
- [Groq models](docs/architecture/groq-models.md): benchmarks and rate limits.
- [Rules database](docs/architecture/rules.md): inventory checks, safety rules and look-fors as sourced, reviewable data in `data/rules/`.
- [Data sources](docs/architecture/datasources.md) and [Dataset bridging](docs/architecture/dataset_bridging.md): official guidance to ground scenarios, and how medical needs become functional constraints.

### Game loop

1. **Baseline** – sanitized household parameters → inciting incident.
2. **Action & Inject** – each action returns `{ narrative_response, time_elapsed, hours_elapsed, new_inject, critical_alerts, scenario_status }`, and the clock advances.
3. **Exercise complete** – after `TARGET_DURATION_HOURS` (72) in-game hours. There's no win or lose: setbacks are things to respond to, and feedback on each response says what you covered, what to consider and why it matters.
4. **Debrief** – what you need to know about your situation, what you can do better, and what went well. No grade.

### Privacy: masking, not anonymization

Before anything is sent to `/api/ttx`, the browser replaces the names in your household profile, names you add in Settings, and detected addresses, phone numbers, email addresses, ZIP codes and URLs with tags such as `[Person 1]`. Tags are restored in the browser before rendering. Your profile stays in this browser's storage; its real values aren't sent.

Each household briefing and response opens a review first: the exact masked text, which you can edit or mask further (**Mask selected text**), sent only when you choose **Send this**. **Back** sends nothing. The review shows what leaves the browser; it doesn't guarantee anonymity or control how long a provider keeps what it receives.

The debrief button sends the existing exercise history, including reviewed participant messages and model-generated events, for another model call; it does not open a separate editable preview. Settings keys go to ReadyState's server to authenticate with the selected provider, not into conversation text. The retry settings snapshot stays in memory, separate from exercise messages, and is cleared when the exercise is reset; it must not be logged or included in future saved exercise history.

What masking doesn't do:

- **Your circumstances are sent.** The model provider receives the household's ages, functional needs (such as "refrigerated medication"), pets, home, supplies and region, and your responses with identifiers masked.
- **Detection in free text can miss things.** A name that isn't in your profile or Settings, or an identifier in an unusual format, can get through. Leave out anything you wouldn't want a provider to see.
- **Running ReadyState locally doesn't make the AI local.** Your masked text goes to the provider you choose. Only a local model (Ollama) keeps it on your machine.
- **Server logs** record only a failed call's status, error kind and code, and which debrief checks failed, never prompts, responses or keys. A host such as Vercel keeps its own request logs.

## License

[AGPL-3.0-only](LICENSE). You may self-host and modify ReadyState freely. If you offer a modified version as a network service, you must publish your changes.
