# ReadyState
ReadyState is a dynamic, AI-powered Tabletop Exercise (TTX) simulator designed for personal and household emergency preparedness.

Run it yourself with your own model API keys (or a fully local model through Ollama). For a private online trial, follow the [Vercel trial guide](docs/deployment/vercel-trial.md). The paid hosted service is not implemented yet; see [Deployment modes](docs/architecture/deployment-modes.md).

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

Open http://localhost:3000 for the website, or http://localhost:3000/journal for the app. Then pick a provider and paste your API key in the app's **Settings**, or set keys in `.env.local`. Supported providers are Groq (default), Google Gemini, Cerebras, OpenRouter, Ollama (local, no key) and any OpenAI-compatible endpoint. Keep self-hosted instances on localhost or a trusted network; see the [security notes](docs/architecture/deployment-modes.md#security-notes).

Scripts: `npm run dev`, `npm run build`, `npm start`, `npm run lint`, `npm run typecheck`, `npm test` (Vitest). CI (`.github/workflows/ci.yml`) runs all of these plus a Docker smoke test on every PR.

## Architecture

| Path | Purpose |
| --- | --- |
| `store/usePrivacyStore.ts` | In-memory Zustand ledger (`entityMap`: tag → real value) and the always-mask name list. |
| `lib/household.ts` / `store/useHouseholdStore.ts` | Structured household profile from the setup wizard (`components/household-wizard.tsx`), saved in this browser only. `describeHousehold` turns it into the attribute summary the engine sees: needs as functional tags, no names or medication names, and skipped sections marked unknown. |
| `store/useSettingsStore.ts` | Self-hosted provider choice and API key, persisted to this browser's `localStorage`. |
| `utils/obfuscator.ts` | `maskInput` replaces people, pets, places, street addresses, postcodes, phones, emails, URLs and ID numbers with tags (`[Person 1]`, `[Pet 1]`, `[Phone 1]`, …) using patterns, context rules ("my wife Priya", "our dog Max"), compromise NLP and the user's always-mask list. `unmaskOutput` restores them. Tested against `utils/masking-corpus.ts`. |
| `lib/ttx.ts` | Zod schemas for the `generate_turn` and `after_action_report` tools, `deriveTtxState` (the TTX state machine) and `buildExercisePrompt` (compact per-call briefing). |
| `lib/providers.ts` | Provider presets and `resolveModel`, which picks the model per request from browser settings or server env. |
| `lib/config.ts` / `lib/hosted.ts` | `READYSTATE_MODE` and the hosted-service integration points (auth, quota, usage metering). |
| `app/api/ttx/route.ts` | `streamText` route that **forces** the tool matching the current phase, so every response is structured JSON. |
| `app/api/config/route.ts` | Key-free description of the server's setup (mode, providers) for the UI. |
| `app/page.tsx` | The public website. |
| `app/(app)/` | The app, inside a shared navigation shell (`components/app-shell.tsx`): Journal, Exercises, the active exercise (`exercise/page.tsx`: response options, feedback, keeping steps in your plan, the decision path and the debrief), My household, Action plan and Settings. |
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
