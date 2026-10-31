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
| D6 | **Knowledge-base review and license.** Who signs off on medical and life-safety content (a qualified clinician or emergency manager), and whether the knowledge base is published as an open dataset (for example CC BY 4.0 for our own writing). | Research R1, R3, R9 |
| D7 | ✅ **Decided 2026-10-27, revised: build two visual treatments and A/B test them.** Style A is the Journal treatment ([design brief](../product/design-brief.md) §4: warm paper, Source Serif and Sans, forest teal). Style B is the Modern treatment ([design treatment](../product/design-treatment-modern.md): midnight navy, Inter, cyan). Both run on one set of semantic tokens over identical screens, content and steps, so the test compares the treatment and not the product. Keeping two styles after the test is not a commitment (Modern treatment §13). The current dark "control plane" UI is retired either way. | Frontend F8, F14; Design DS1–DS3 |
| D8 | ✅ **Decided 2026-10-27: practice framing instead of win/lose.** The engine today ends in `survived` or `failed` with a letter grade. The brief frames exercises as practice with feedback on every decision, a path instead of a percentage, and no shaming. Decision: keep realistic consequences, but drop the fail state and grade in favor of per-decision feedback and an action plan. There is no win or lose: the debrief answers "what do I/we need to know?" and "what can I/we do better?" | Simulation G1, G8; Frontend F9, F10 |
| D9 | ✅ **Decided 2026-10-27: where health constraints live.** `dataset_bridging.md` proposes a server-side `health_constraints` table; the brief keeps detailed profiles on the device. Decision: local by default, server copy only for opt-in hosted sync. | Research R11, Hosted H6 |
| D10 | **A/B test design.** Before any live test, settle: the primary measure (the Modern treatment proposes sample starts per eligible unique visitor, with sample completion as a quality check), assignment, privacy-conscious analytics, sample size and stopping criteria. The aim is to learn which treatment helps people understand the product and practice usefully, and what each does better, not to crown a favorite on visual preference or raw clicks (Modern treatment §15). | Frontend F14, Hosted H8 |

## Product direction

The [product and experience design brief](../product/design-brief.md) is the reference for what ReadyState should feel like and do. Its visual identity is Style A; the [Modern design treatment](../product/design-treatment-modern.md) is Style B, built on the same screens for an A/B test (D7, D10). The supporting research is in [Data sources](../architecture/datasources.md) and [Dataset bridging](../architecture/dataset_bridging.md).

What the brief changes:

- **The core loop becomes respond → feedback → action.** The participant writes a response, then sees "What you covered," "What to consider" and "Why it matters," and can turn a lesson into an action-plan item. Today, feedback arrives only once, in the final AAR (G8, F9, F12).
- **Privacy shifts toward attributes.** The engine should receive "two adults, one young child, one person needs help with stairs, urban area," built from a structured profile with a visible "What the scenario engine sees" preview. Free-text masking (S1) stays as the safety net for typed responses (F2, S2).
- **Pause and resume are first-class:** the draft is saved, and resume shows a short recap (F3, G10).
- **Family exercises:** up to three households on their own devices, converging on shared decisions (team 8).
- **A fictional sample exercise before any signup** (F11).

Brief requirements traced to items:

| Brief ID | Requirement | Items |
| --- | --- | --- |
| UX01 | Fictional sample before signup | F11 |
| UX02 | Response before feedback; both readable after | F9, G8 |
| UX03 | Resume with saved response and recap | F3, G10 |
| UX04 | Lesson becomes a linked action | F12, G8 |
| UX05 | Basic profile first, optional detail later | F2 |
| GR01–GR04 | Up to three households, shared decision, reveal rule, own devices | C1–C4 |
| VS01 | Journal palette and shared labels on all surfaces | F8 |
| PR01 | Personalization separate from data contribution; engine preview | S2, F2 |
| AC01 | Keyboard, focus, text scaling, status without color | F7 |

## 1. Privacy & Security

The masking layer is the product's core promise, and it currently leaks. A probe of `maskInput` (2026-10-27) found:

- Missed names: "Priya", "Linh", "Bao", "Mai", "the Nguyens", and the surname in "Tim Escolopio".
- Missed location details: city/state/ZIP ("Denver CO 80203").
- Missed contact details: phone numbers and email addresses.
- A pet name ("Max") tagged as `[Person 2]`.

| Pri | Item | Done when |
| --- | --- | --- |
| P0 | **S1. Harden masking.** _Done in PR #6, except the structured form (F2)._ Add regex detectors for phone, email, ZIP/postcode, street addresses and URLs. Add a user-maintained "names to always mask" list. Move to a structured household form (S2) so names are entered in name fields, not free text. | A corpus of ≥50 realistic household descriptions in `utils/obfuscator.test.ts` sends no known PII to the server. |
| P0 | **S2. Show the user exactly what is sent.** Preview the masked text before transmit, with one-click "mask this word" (works with Frontend F2). | The user can see and correct the outgoing text for every message. |
| P1 | **S3. Web hardening.** Add a Content-Security-Policy and security headers (keys live in `localStorage`, so XSS means key theft). Add a request body size limit on `/api/ttx` and per-IP rate limiting in hosted mode. Add a `Host` allowlist against DNS rebinding (the same-origin check in `/api/ttx` can't catch it, because Origin and Host both carry the attacker's hostname). | Headers verified; oversized or abusive requests rejected. |
| P1 | **S4. Policies.** Privacy policy (what reaches the AI provider: masked text plus medical/situational details), terms of service, and a "not professional emergency or medical advice" disclaimer in the UI. Depends on D4 and D5. | Published and linked from the app. |
| P1 | **S5. AGPL §13 compliance.** The hosted UI must offer users the source of the running version (footer "Source" link to the repo at the deployed commit). | Link present in hosted mode. |
| P2 | **S6. Prompt-injection screening.** Run Groq Prompt Guard on participant input in hosted mode. | Measured false-positive rate documented. |

## 2. Simulation (game engine and AI quality)

| Pri | Item | Done when |
| --- | --- | --- |
| P0 | **G1. Proportionate setbacks.** _The fail state is gone (D8, PR #8), but escalation is still steep: in a 72-hour test the dog had severe hypothermia by Hour 18._ In testing, a household lost at Hour 12 to stacked injects with doubtful physics (snow cooler melting in a sub-zero storm). Allow recovery from a single setback; require escalation before `failed`. | In scripted "reasonable household" runs, setbacks stay proportionate: no severe injury or loss before Hour 24 unless a response ignored a stated danger. |
| P0 | **G2. Eval harness.** Turn the scratch benchmark and playthrough scripts into `scripts/eval/`: scripted households × providers, checking schema validity, tag preservation, outcome distribution, tokens and latency. | `npm run eval` produces a report. It's the gate for G1, G3 and prompt changes. |
| P1 | **G3. Benchmark the other providers** on the forced tool call (Gemini, Cerebras, OpenRouter, Ollama models such as `gpt-oss:20b`). Today only Groq is verified. | `docs/architecture/` updated with results; any unreliable provider is labelled in Settings. |
| P1 | **G4. Rate-limit handling.** _Partly done in PR #14: provider errors (daily and per-minute limits, bad keys, unknown models, incomplete turns) now get specific messages without raw provider text. Still to do: an automatic retry on an incomplete turn._ Turn provider 429s into "Rate limited, retry in N s" (from `retry-after`) instead of a generic error, and retry once on a malformed tool call. | Covered by route tests. |
| P2 | **G5. Scenario variety.** Scenario picker (winter storm, heat wave, flood, wildfire evacuation, earthquake, extended outage) and difficulty levels. Built on Research R2 (taxonomy), R6 (injects) and R7 (tiers). | Selectable in the UI; covered by eval. |
| P2 | **G6. Long-game budget.** Trim or summarize the oldest log lines past ~10 turns (see the compact briefing in `lib/ttx.ts`). | 20-turn eval stays under 5k tokens per request. |
| P1 | **G8. Per-decision feedback.** _Done in PR #8 (schema, prompt, and display in the current UI)._ Add `feedback` (`covered`, `consider`, `why`) and `suggested_actions` to the `generate_turn` schema, so every response is evaluated, not only the final AAR. Acknowledge alternative reasonable responses, per the brief. Depends on D8. | Every turn carries structured feedback; eval checks it references the participant's actual response. |
| P1 | **G9. Continuity guardrails.** Track resources explicitly in the briefing (water, stored power in Wh, medication days, as in `dataset_bridging.md`) and established events, so the model can't contradict earlier turns. This is also the structural fix behind G1's melting snow cooler. | Eval finds no contradictions of time, resources or prior choices across 12-turn runs. |
| P0 | **G11. Safety eval.** Check every turn's feedback and `suggested_actions` for dangerous advice: indoor fuel-burning heat, generators indoors, re-entering after a gas leak, and medical treatment beyond basic first aid. Use a rule list plus a model judge, as part of G2. Found in testing: before the safety rules were added, the model suggested lighting a gas stove indoors for heat. | Zero violations across the eval suite; it blocks prompt changes. |
| P1 | **G12. Guided responses.** _Done in PR #10._ Each turn offers three or four plausible responses of varying quality, without marking the best one. Choosing one fills the response box for editing, and a custom response is always possible. Next: measure in the eval whether options give away the answer, and whether participants who pick options learn less than those who write their own. | Options shown every turn; eval checks variety. |
| P1 | **G13. Look-fors at each stage.** What a sound response should cover at each stage of each emergency (HSEEP critical tasks), selected on the device for the household. Sent with each turn; feedback reports `addressed` and `missed`; missed items and inventory gaps drive later injects and the debrief. Design: [Exercise objectives](../architecture/exercise-objectives.md#2-look-fors-at-each-stage-proposed). Depends on R5 and R6 for content. | A first library for power outage and winter storm; eval checks that feedback catches missed look-fors. |
| P2 | **G10. Resume recap.** A short "what has happened and what you decided" summary, built from the exercise log without a model call where possible. | Resume shows a recap of three sentences or fewer. |
| P1 | **G7. Knowledge retrieval.** Add the few knowledge-base records relevant to the current hazard and phase to `buildExercisePrompt`, capped at about 500 tokens (the 8k TPM Groq limit is the constraint), and have the AAR cite record IDs. Depends on R1. | Eval shows grounded injects and cited recommendations within the token cap. |

## 3. Frontend & UX

| Pri | Item | Done when |
| --- | --- | --- |
| P0 | **F1. Verify the Settings panel in a browser.** It was API-tested only. | Save / reset / provider switch / error display checked on Chrome, Firefox and Safari. |
| P0 | **F2. Structured household setup.** _First version in PR #10: a six-step wizard (people, pets, home, health needs, supplies, review) with the engine preview. Not yet: editing the profile mid-exercise, and R11-reviewed thresholds._ Replace the free-text baseline with a progressive form, per brief §7: start with household size, age ranges and general location, then optional pets, housing, supplies, mobility and medical needs. Medical needs map to functional-constraint tags (R11), so the diagnosis never leaves the device. Unknown fields stay unknown rather than becoming assumptions. The form generates the attribute summary shown in the "What the scenario engine sees" preview (S2). | The baseline is generated from the form; first practice works with only the basic fields; free text remains an option. |
| P1 | **F3. Persist exercises locally.** Use Dexie (installed, unused) so a reload doesn't lose the exercise, and keep a history list of past AARs. | Reload resumes; history view lists past exercises. |
| P1 | **F4. Mobile layout pass.** Fixed `h-[60vh]` scroll areas and the sidebar need a phone layout (collapsible panels). Add proper PWA icons (only `favicon.ico` exists). | Usable at 360 px wide; installs with real icons. |
| P1 | **F5. Hosted-mode UI.** Sign-in, plan/credits display, and handling of 401 (sign in) and 402 (upgrade). Depends on H1. | Flows work against Hosted team endpoints. |
| P2 | **F6. AAR export.** Print-friendly view and PDF download. Optionally a supply checklist built from `supply_gaps`. | Exported AAR matches the on-screen report. |
| P2 | **F7. Accessibility.** Keyboard flow, screen-reader labels for streaming output, and an alternative to the `animate-pulse` alerts. 44 × 44 px touch targets and status that doesn't rely on color alone (brief AC01). | axe clean; reduced-motion respected. |
| P1 | **F8. Theme system with both treatments.** _Done in PR #18; see [Design system](../product/design-system.md)._ Semantic tokens (canvas, surface, surface-raised, input, border-subtle, border-control, text-primary/secondary/muted, action-primary/hover, on-action, success, attention, error, focus) as CSS variables in Tailwind, selected by `data-style="a"` or `"b"` on `<html>`. Style A: the brief's palette and Source Serif 4 and Source Sans 3. Style B: the Modern palette and Inter. Load fonts with `next/font`. Components use only tokens, so no screen or scenario logic is duplicated per style. Also covers the shared spacing scale and the icon. Depends on D7. | Both styles pass WCAG AA contrast for every state the Modern treatment lists (§9, §11); a screen renders identically in content and order in A and B. |
| P1 | **F9. Respond-then-feedback flow.** Scenario entry (label, simulated time, title, situation, prompt), then a spacious response field and "Submit response." Feedback appears below, in three parts, with the submitted response kept visible. "Save and leave" and "Continue the exercise" as secondary actions. Uses G8. | Brief UX02 met on mobile and desktop. |
| P1 | **F10. Decision path.** _Done in PR #18._ Replace the percentage bar with a path of completed decisions, the labeled current step and an open continuation, with no spoilers. | No percentage anywhere in the exercise UI. |
| P1 | **F11. Sample exercise.** _Partly done in PR #18: `/exercise?sample=alex` from the website, plus a recorded preview (`?preview=1`) that needs no API key. Still to do: a short fixed sample that ends in "Make this mine"._ A fixed, short power-outage exercise with a fictional household (the brief's "Alex"), with no account, settings or round controls, ending in "Make this mine." | Brief UX01; works with no API key configured (canned or cached responses). |
| P1 | **F12. Running plan.** One checklist that builds through the exercise, grouped as Get, Plan and Practice, from inventory findings (F15), missed look-fors (G13) and suggested actions. Each item links to its decision; the participant keeps, edits or dismisses it; stored locally (F3). See [Exercise objectives](../architecture/exercise-objectives.md#3-the-running-plan-proposed). | Brief UX04; items survive reload; the debrief's "what you can do better" is this list. |
| P1 | **F15. Inventory check.** _Done in PR #14._ Compares the household profile with Ready.gov and CDC guidance (water, food, pet food, medication days and cold chain, device power, CO and smoke detectors, basic kit, emergency-specific items) on the wizard's Review step, and sends the gaps with the baseline so injects can test them. | Every finding has a status and a Get or Plan action; thresholds sourced in R3. |
| P1 | **F14. Style assignment.** _Partly done in PR #18: `?style=a|b` and a remembered choice, default A. Still to do: random 50/50 assignment and event tagging._ Randomly assign each new browser to A or B (50/50), keep it sticky in localStorage, allow a `?style=a|b` override for testing and demos, and include the style in experiment events (H8). Self-hosted defaults to A, with the override available. Depends on F8 and D10. | Assignment is stable across reloads; the split is verified in a test. |
| P2 | **F13. Navigation.** Journal, Exercises, My household, Action plan and Settings, with labeled bottom navigation on mobile and a sidebar on desktop. | Matches brief §3 on both layouts. |

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
| P1 | **H8. Experiment analytics.** Privacy-conscious measurement for the A/B test: aggregate, cookieless counts of sample starts, sample completions and the Modern treatment's prototype measures (response completion, next-action discovery), tagged with the style. No prompt content, household data or identifiers. Hosted only and disclosed in the privacy policy (S4). Depends on D10. | Results can be read per style; a privacy review finds no personal data. |
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

## 7. Research & Knowledge Base

Today every scenario, inject and AAR recommendation comes from the model's memory. That's how the G1 failure (a snow cooler melting in a sub-zero storm) happened. This team builds a sourced, reviewed knowledge base that the simulation retrieves from (G7), so that injects are physically plausible and advice cites real guidance. The knowledge base is retrieved per turn; it isn't used for fine-tuning.

**Sourcing rules for every record:**

- **Prefer US government works:** FEMA/Ready.gov, NWS/NOAA, USGS, CDC, CISA and DOE. These are generally public domain, but check for third-party photos or content inside them.
- **Military doctrine:** only documents marked *Distribution Statement A* (approved for public release). Never use restricted-distribution, CUI/FOUO or export-controlled material.
- **Copyrighted guidance** (Red Cross, NFPA, publishers): cite and paraphrase, and link out. Don't bulk-copy without a license.
- **Provenance:** every record carries the source URL, publisher, publication date, retrieval date, license and reviewer.
- **Medical and life-safety content** ships only after review by the person named in D6.

| Pri | Item | Done when |
| --- | --- | --- |
| P1 | **R1. Schema and provenance.** _Started in PR #15: the [rules database](../architecture/rules.md) in `data/rules/` (sources, inventory checks, safety rules, draft look-fors) with a Zod schema and validation in `npm test`. Every rule is still a draft and every source unverified._ Define record types in `data/kb/` as JSON or YAML validated by Zod: hazard, guidance, case study, inject, supply item and readiness tier, each with the provenance fields. Keep a license allowlist and add a CI check (with P1) that rejects records with no source or a disallowed license. | Schema and validator merged; 10 seed records pass CI. |
| P1 | **R2. Hazard taxonomy.** Start from the 18 natural hazards in FEMA's National Risk Index. Add technological and human-caused hazards: grid failure, water contamination, hazmat release, pandemic, cyberattack on utilities and civil unrest. Record for each: onset speed, warning time, typical duration, seasonality, regions, and cascades (for example winter storm → outage → generator carbon monoxide). | Every G5 scenario maps to a taxonomy entry. |
| P1 | **R3. Official guidance corpus.** Short, atomic do/don't records per hazard and phase (before, during, after), from Ready.gov and FEMA's *Are You Ready?*, CDC (water, food safety, carbon monoxide, heat illness), NWS warning products, USGS (earthquakes) and CISA. | Each launch scenario's hazard has cited guidance for every phase. |
| P1 | **R4. Historical case studies.** Sourced timelines from official reports and after-action reviews: the February 2021 Texas winter storm, the 2023 Lahaina wildfire, the 2018 Camp Fire, Hurricane Maria's extended outage, the 2003 Northeast blackout and the Flint water crisis. Extract what failed for households, and when. | ≥ 8 case studies; R6 injects cite them. |
| P1 | **R5. Exercise doctrine and debrief.** Align the game loop and AAR with FEMA's Homeland Security Exercise and Evaluation Program (HSEEP), scaled to households: exercise objectives, capability targets, a master inject list, and the AAR/Improvement Plan format. This defines how feedback and the debrief identify what a household needs to know and can do better; it's not a scoring rubric. | The AAR schema in `lib/ttx.ts` maps to the rubric; Simulation adopts it. |
| P1 | **R6. Inject library.** Realistic injects per hazard, each with preconditions (season, temperature, hours elapsed, what has already failed) and typical timing drawn from R4. The model selects or adapts injects instead of inventing them. | The G2 eval includes a plausibility check, and G1 harshness re-measured with the library. |
| P2 | **R7. Readiness tiers ("milspec").** Graded levels, cited per criterion: basic (Ready.gov kit), extended self-reliance (two weeks or more), and advanced. The advanced tier borrows public military planning practice: PACE communications plans (primary, alternate, contingency, emergency), METT-TC-style situation assessment, rehearsals and drills, load-out checklists, and Distribution A survival doctrine such as ATP 3-50.21. These tiers drive difficulty levels and AAR recommendations. | Tiers documented; difficulty selection uses them. |
| P2 | **R8. Regional risk data.** Bundle FEMA National Risk Index county scores and NOAA climate normals, so a household's region sets its likely hazards and weather. Use coarse regions only (state or county, never an address), consistent with S1. | Region → top hazards and seasonal conditions works offline. |
| P2 | **R9. Special-needs guidance.** Infants, older adults, disabilities, pets and livestock, medications that need refrigeration, and powered medical devices (oxygen concentrators, CPAP, dialysis). This feeds the medical-needs fields in F2. Requires D6 review. | Every F2 medical-needs option has reviewed guidance records. |
| P2 | **R10. Freshness.** Annual re-review, a link checker in CI, and a changelog for guidance that changes. | Stale or broken sources are flagged automatically. |
| P1 | **R11. Functional constraint dictionary.** Turn [Dataset bridging](../architecture/dataset_bridging.md) into the canonical tag list (`[Refrigerated Medication Dependent]`, `[Hardware Power Dependent]`, `[Air Quality Sensitive]`, `[Anaphylaxis Risk]`, …). Each tag carries thresholds (temperature range, watts, buffer days) with a primary source. Resolve the review notes in that doc first (CPAP wattage, stockpile wording, missing citations). Requires D6 and D9. | F2 emits only dictionary tags; every threshold has a source. |

The sources in [Data sources](../architecture/datasources.md) seed R3 (Ready.gov, CDC, USDA), R8 (FEMA NRI, NWS) and R9 (CDC special needs, Ready.gov and ASPCA pets).

## 8. Groups (family and community)

The brief's family model: up to three households, each on its own devices, with private local injects that converge on shared decisions. Needs a shared real-time backend, so it follows the hosted beta. Many rules are still open in the brief (§9).

| Pri | Item | Done when |
| --- | --- | --- |
| P2 | **C1. Group sessions.** Data model and sync for a group exercise: households, participants and devices, a shared clock, and per-household and shared injects (Supabase Realtime in hosted mode). | Three households on separate devices stay in sync. |
| P2 | **C2. Family overview.** Up to three household cards showing chosen shared updates and progress, plus a clear active-household indicator. | Brief GR01. |
| P2 | **C3. Shared decisions and reveal rules.** A shared inject collects each household's response. The organiser picks "show as they arrive" or "hide until discussion," and the rule is shown before anyone answers. | Brief GR02, GR03. |
| P2 | **C4. Private versus shared context.** Profiles and notes stay in their household; only deliberately shared summaries reach the group, with a consent step. | Brief GR04; covered by tests. |

## 9. Product design

| Pri | Item | Done when |
| --- | --- | --- |
| P0 | **DS1. First prototype, in both styles** (brief §9, Modern treatment §14 phase 1). The power-outage exercise at mobile and desktop sizes, in three states: new inject, draft response, feedback revealed. Same content in Style A and Style B. Test with Sam's household and Alex's sample journey. | Clickable prototypes of both styles reviewed by the owner; guide F8–F12. |
| P1 | **DS2. Usability round, A versus B.** Answer the brief's five persona questions with representative users, half on each style, observing the Modern treatment's measures: response completion, next-action discovery, household-context mistakes, privacy misunderstandings and perceived comfort. | Findings per style documented; changes filed. |
| P1 | **DS3. Brand.** Naming (the brief says Ready State, the Modern treatment ReadyState) and the icon (the brief's unfinished path versus the Modern treatment's dots gathering into a home), recognizable in both styles. | Name and icon chosen; vector marks and PWA icons (F4) produced. |
| P2 | **DS4. Family prototype.** Three households, private injects, one shared decision, both reveal rules. | Guides C1–C4. |

## Suggested sequencing

1. **Now, in parallel:**
   - Privacy S1/S2, Simulation G1/G2, Frontend F1/F2, Platform P1.
   - Research R1/R2. Everything else in Research builds on them.
   - Design DS1, which shapes all the journal UI work.
   - Owner decisions D1–D3 and D6–D9.
2. **Self-hosted release v0.2, the journal experience:** S1, S2, G1, G8, G9, F1–F3 and F8–F10 (both styles, A by default), plus P1/P2. The brief puts the visual identity and the individual exercise flow first; DS2 compares the styles with users. Publish the image and announce self-hosting. Research continues with R3–R6 and R11 in parallel.
3. **Hosted beta:** H1–H5, F5, F11, F12, S3–S5, P3, and the live A/B test (F14, H8, per D10), plus G7 with R3–R6, so paying users get grounded scenarios. Invite-only, then public.
4. **After launch:** G5/G6/G10 with R7/R8, R9/R10, F6/F7/F13, H6/H7, then groups (DS4, C1–C4), desktop (M1/M2) and mobile (M3/M4).
