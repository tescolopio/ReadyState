# Work breakdown by team

_Written 2026-10-27 against `feat/standalone-app` (PR #3). Priorities: **P0** blocks any public release, **P1** is needed for the hosted launch, **P2** comes after launch._

Background reading: [Deployment modes](../architecture/deployment-modes.md) and [Groq models](../architecture/groq-models.md).

## Decisions needed from the product owner

These block work below and only the owner can make them:

| # | Decision | Blocks |
| --- | --- | --- |
| D1 | **Pricing model:** subscription vs prepaid exercise credits vs both. Model cost is about $0.01 per 12-turn exercise (estimated). | Hosted H3/H4 |
| D2 | **Create the Supabase and Stripe projects** (test mode first) and share access with the Hosted team. | Hosted H1–H4 |
| D3 | **Contributor License Agreement.** To sell anything under terms other than AGPL later (for example an enterprise license), outside contributions need a CLA *before* the first external PR is merged. | Platform P4, opening the repo to contributors |
| D4 | **Legal review** of the privacy policy, terms and medical/safety disclaimer before the hosted launch. | Security S4 |
| D5 | **Which provider the hosted service uses** (Groq paid tier is the default assumption) and the data-processing terms to advertise. | Hosted H5, Security S4 |

## 1. Privacy & Security

The masking layer is the product's core promise, and it currently leaks. A probe of `maskInput` (2026-10-27) found:

- Missed names: "Priya", "Linh", "Bao", "Mai", "the Nguyens", and the surname in "Tim Escolopio".
- Missed location details: city/state/ZIP ("Denver CO 80203").
- Missed contact details: phone numbers and email addresses.
- A pet name ("Max") tagged as `[Person 2]`.

| Pri | Item | Done when |
| --- | --- | --- |
| P0 | **S1. Harden masking.** Add regex detectors for phone, email, ZIP/postcode, street addresses and URLs. Add a user-maintained "names to always mask" list. Move to a structured household form (S2) so names are entered in name fields, not free text. | A corpus of ≥50 realistic household descriptions in `utils/obfuscator.test.ts` sends no known PII to the server. |
| P0 | **S2. Show the user exactly what is sent.** Preview the masked text before transmit, with one-click "mask this word" (works with Frontend F2). | The user can see and correct the outgoing text for every message. |
| P1 | **S3. Web hardening.** Add a Content-Security-Policy and security headers (keys live in `localStorage`, so XSS means key theft). Add a request body size limit on `/api/ttx` and per-IP rate limiting in hosted mode. | Headers verified; oversized or abusive requests rejected. |
| P1 | **S4. Policies.** Privacy policy (what reaches the AI provider: masked text plus medical/situational details), terms of service, and a "not professional emergency or medical advice" disclaimer in the UI. Depends on D4 and D5. | Published and linked from the app. |
| P1 | **S5. AGPL §13 compliance.** The hosted UI must offer users the source of the running version (footer "Source" link to the repo at the deployed commit). | Link present in hosted mode. |
| P2 | **S6. Prompt-injection screening.** Run Groq Prompt Guard on participant input in hosted mode. | Measured false-positive rate documented. |

## 2. Simulation (game engine and AI quality)

| Pri | Item | Done when |
| --- | --- | --- |
| P0 | **G1. Fix failure harshness.** In testing, a household lost at Hour 12 to stacked injects with doubtful physics (snow cooler melting in a sub-zero storm). Allow recovery from a single setback; require escalation before `failed`. | ≥70% of scripted "reasonable household" runs reach Hour 72. |
| P0 | **G2. Eval harness.** Turn the scratch benchmark and playthrough scripts into `scripts/eval/`: scripted households × providers, checking schema validity, tag preservation, outcome distribution, tokens and latency. | `npm run eval` produces a report. It's the gate for G1, G3 and prompt changes. |
| P1 | **G3. Benchmark the other providers** on the forced tool call (Gemini, Cerebras, OpenRouter, Ollama models such as `gpt-oss:20b`). Today only Groq is verified. | `docs/architecture/` updated with results; any unreliable provider is labelled in Settings. |
| P1 | **G4. Rate-limit handling.** Turn provider 429s into "Rate limited, retry in N s" (from `retry-after`) instead of a generic error, and retry once on a malformed tool call. | Covered by route tests. |
| P2 | **G5. Scenario variety.** Scenario picker (winter storm, heat wave, flood, wildfire evacuation, earthquake, extended outage) and difficulty levels. | Selectable in the UI; covered by eval. |
| P2 | **G6. Long-game budget.** Trim or summarize the oldest log lines past ~10 turns (see the compact briefing in `lib/ttx.ts`). | 20-turn eval stays under 5k tokens per request. |

## 3. Frontend & UX

| Pri | Item | Done when |
| --- | --- | --- |
| P0 | **F1. Verify the Settings panel in a browser.** It was API-tested only. | Save / reset / provider switch / error display checked on Chrome, Firefox and Safari. |
| P0 | **F2. Structured household setup.** Replace the free-text baseline with a form (people and roles, pets, medical needs, supplies, home type, region). It feeds S1 and produces cleaner prompts. | The baseline is generated from the form; free text remains an option. |
| P1 | **F3. Persist exercises locally.** Use Dexie (installed, unused) so a reload doesn't lose the exercise, and keep a history list of past AARs. | Reload resumes; history view lists past exercises. |
| P1 | **F4. Mobile layout pass.** Fixed `h-[60vh]` scroll areas and the sidebar need a phone layout (collapsible panels). Add proper PWA icons (only `favicon.ico` exists). | Usable at 360 px wide; installs with real icons. |
| P1 | **F5. Hosted-mode UI.** Sign-in, plan/credits display, and handling of 401 (sign in) and 402 (upgrade). Depends on H1. | Flows work against Hosted team endpoints. |
| P2 | **F6. AAR export.** Print-friendly view and PDF download. Optionally a supply checklist built from `supply_gaps`. | Exported AAR matches the on-screen report. |
| P2 | **F7. Accessibility.** Keyboard flow, screen-reader labels for streaming output, and an alternative to the `animate-pulse` alerts. | axe clean; reduced-motion respected. |

## 4. Hosted service (backend)

All items depend on D1/D2. Integration points already exist in `lib/hosted.ts` and `supabase/migrations/20261027010000_create_billing.sql`.

| Pri | Item | Done when |
| --- | --- | --- |
| P1 | **H1. Auth.** Implement `authenticate` with Supabase Auth (verify the session JWT) and return it from `getHostedServices`. | Hosted `/api/ttx` returns 401 signed out and 200 signed in. |
| P1 | **H2. Quota and metering.** Implement `checkQuota` (reads `subscriptions`) and `recordUsage` (inserts `usage_events`, decrements credits) with the service-role client, server-only. | Usage rows per call; 402 at zero credits. |
| P1 | **H3. Stripe Checkout.** Plans per D1 and a customer portal for managing a subscription. | A test-mode purchase updates `subscriptions`. |
| P1 | **H4. Stripe webhook** (`app/api/billing/webhook`) with signature verification and idempotent upserts. | Replayed and out-of-order events handled. |
| P1 | **H5. Production provider.** Move to Groq's paid tier (higher limits, no training), with alerting on spend and on 429 rate. | Dashboards and alerts exist. |
| P2 | **H6. Cloud Sync.** Write sanitized results to `sim_logs` for signed-in users (opt-in). | History syncs across devices. |
| P2 | **H7. Account lifecycle.** Data export and deletion (cascades are already in the schema). | Self-serve export and delete. |

## 5. Platform & DevOps

| Pri | Item | Done when |
| --- | --- | --- |
| P0 | **P1. CI.** GitHub Actions running lint, typecheck, tests and build on every PR, plus a Docker build with a smoke test (`/api/config` returns 200; hosted mode returns 503). | Required check on `main`. |
| P1 | **P2. Release pipeline.** Versioned images to GHCR (`ghcr.io/tescolopio/readystate`) with a changelog, so self-hosters can `docker pull` instead of building. | A tagged release publishes the image. |
| P1 | **P3. Hosted deployment.** Pick a host for the hosted service (Vercel works since the routes are stateless; or a container host). Set up environments: staging and production. | Staging auto-deploys from `main`. |
| P1 | **P4. Contributor setup.** CONTRIBUTING, issue/PR templates, CLA bot per D3, and a dependency update policy (pin versions ≥ 2 weeks old, as done for `@ai-sdk/google`). | Templates live; CLA enforced if chosen. |
| P2 | **P5. Health endpoint and observability** (structured logs without prompt content, error tracking). | Liveness probe; errors visible. |
| P2 | **P6. Tidy-ups.** Decide on the blocked `unrs-resolver` install script, and line-ending normalization (`.gitattributes`; CRLF warnings on every commit). | No warnings on commit or install. |

## 6. Desktop & Mobile

| Pri | Item | Done when |
| --- | --- | --- |
| P2 | **M1. Desktop spike (Tauri preferred for size).** Bundle `.next/standalone/server.js` as a sidecar on a random localhost port and open a webview. | Runs on Windows and macOS with Ollama and Groq. |
| P2 | **M2. Desktop distribution.** Code signing (Windows and Apple notarization) and auto-update. | Signed installers per OS. |
| P2 | **M3. Shared core package.** Extract `utils/obfuscator.ts`, `lib/ttx.ts` and the prompt builder into a workspace package for non-web clients. Needs S1 first so the hardened masker is what's shared. | The web app consumes the package with no behavior change. |
| P2 | **M4. Native mobile client (Expo).** Thin client over `/api/config` and `/api/ttx`, with on-device masking and two backends: a self-hosted URL or a hosted account. PWA (F4) covers phones until then. | TestFlight / internal track build. |

## Suggested sequencing

1. **Now, in parallel:**
   - Privacy S1/S2, Simulation G1/G2, Frontend F1/F2, Platform P1.
   - Owner decisions D1–D3.
2. **Self-hosted release v0.2:** after S1, S2, G1, F1–F3 and P1/P2. Publish the image and announce self-hosting.
3. **Hosted beta:** H1–H5, F5, S3–S5, P3. Invite-only, then public.
4. **After launch:** G5/G6, F6/F7, H6/H7, then desktop (M1/M2) and mobile (M3/M4).
