# ReadyState
ReadyState is a dynamic, AI-powered Tabletop Exercise (TTX) simulator designed for personal and household emergency preparedness.

Run it yourself with your own model API keys (or a fully local model through Ollama), or use the hosted online service. See [Deployment modes](docs/architecture/deployment-modes.md).

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

Then pick a provider and paste your API key in the app's **Model Provider** panel, or set keys in `.env.local`. Supported providers are Groq (default), Google Gemini, Cerebras, OpenRouter, Ollama (local, no key) and any OpenAI-compatible endpoint. Keep self-hosted instances on localhost or a trusted network; see the [security notes](docs/architecture/deployment-modes.md#security-notes).

Scripts: `npm run dev`, `npm run build`, `npm start`, `npm run lint`, `npm run typecheck`, `npm test` (Vitest). CI (`.github/workflows/ci.yml`) runs all of these plus a Docker smoke test on every PR.

## Architecture

| Path | Purpose |
| --- | --- |
| `store/usePrivacyStore.ts` | In-memory Zustand ledger (`entityMap`: tag → real value) and the always-mask name list. |
| `store/useSettingsStore.ts` | Self-hosted provider choice and API key, persisted to this browser's `localStorage`. |
| `utils/obfuscator.ts` | `maskInput` replaces people, pets, places, street addresses, postcodes, phones, emails, URLs and ID numbers with tags (`[Person 1]`, `[Pet 1]`, `[Phone 1]`, …) using patterns, context rules ("my wife Priya", "our dog Max"), compromise NLP and the user's always-mask list. `unmaskOutput` restores them. Tested against `utils/masking-corpus.ts`. |
| `lib/ttx.ts` | Zod schemas for the `generate_turn` and `after_action_report` tools, `deriveTtxState` (the TTX state machine) and `buildExercisePrompt` (compact per-call briefing). |
| `lib/providers.ts` | Provider presets and `resolveModel`, which picks the model per request from browser settings or server env. |
| `lib/config.ts` / `lib/hosted.ts` | `READYSTATE_MODE` and the hosted-service integration points (auth, quota, usage metering). |
| `app/api/ttx/route.ts` | `streamText` route that **forces** the tool matching the current phase, so every response is structured JSON. |
| `app/api/config/route.ts` | Key-free description of the server's setup (mode, providers) for the UI. |
| `app/page.tsx` | Dark-mode TTX control plane: masked submit, unmasked rendering, critical alerts, provider settings, AAR view. |
| `components/ui/*` | Minimal shadcn/ui-compatible `Button`, `Input`, `Card`, `ScrollArea`, `Badge`. Replace with the real ones via `npx shadcn@latest add button input scroll-area card badge --overwrite`. |
| `supabase/migrations/*` | `sim_logs`, `subscriptions` and `usage_events` with Row Level Security. |

Further reading: [Deployment modes](docs/architecture/deployment-modes.md) (self-hosted vs hosted, providers, desktop and mobile plans) and [Groq models](docs/architecture/groq-models.md) (benchmarks and rate limits).

### Game loop

1. **Baseline** – sanitized household parameters → inciting incident.
2. **Action & Inject** – each action returns `{ narrative_response, time_elapsed, hours_elapsed, new_inject, critical_alerts, scenario_status }`, and the clock advances.
3. **End condition** – the model reports `failed`, or the participant survives `TARGET_DURATION_HOURS` (72).
4. **After-Action Report** – structured grade, strengths, supply gaps and recommendations.

Real names and places never leave the browser: only the masked text is sent to `/api/ttx`, and tags are restored client-side before rendering.

## License

[AGPL-3.0-only](LICENSE). You may self-host and modify ReadyState freely. If you offer a modified version as a network service, you must publish your changes.
