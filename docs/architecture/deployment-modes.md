# Deployment modes

ReadyState ships as one codebase, and one Docker image, that runs in two modes, selected at runtime by `READYSTATE_MODE`:

| | Self-hosted (default) | Hosted (paid service) |
| --- | --- | --- |
| Who runs it | The user, on their own machine or server | The ReadyState operator |
| Sign-in | None, single user | Required (`HostedServices.authenticate`) |
| Model provider and keys | Server env, or per browser via the Settings panel | Operator's server env only; browser settings are ignored |
| Limits and billing | Whatever the user's provider allows | Quota check before each call, usage recorded after (`checkQuota` / `recordUsage`) |
| Status | Working | Scaffolded; fails closed with 503 until implemented |

The code is licensed **AGPL-3.0-only** (`LICENSE`). Anyone may self-host and modify it, but anyone offering a modified version as a network service must publish their changes.

## Request flow

```
browser ──► POST /api/ttx { messages, settings? }
              │
              ├─ hosted?  getHostedServices() ─ null ──► 503
              │           authenticate(req)  ─ null ──► 401
              │           checkQuota(account) ─ denied ► 402
              │
              ├─ resolveModel(mode, settings)   lib/providers.ts
              │     self-hosted: browser settings ▸ READYSTATE_* env ▸ preset
              │     hosted:      READYSTATE_* env ▸ preset (settings ignored)
              │
              ├─ streamText(buildExercisePrompt(messages), forced tool)
              │
              └─ onFinish ─► hosted? recordUsage(account, tokens)
```

`GET /api/config` returns a description of the server's setup with no keys in it: the mode, the default provider, and which providers already have a server key. The UI uses it to decide whether to show the Settings panel. It calls `connection()`, so env is read per request rather than baked in at build time.

## Providers

Presets live in `lib/providers.ts`:

| Id | Endpoint | Default model | Key env | Notes |
| --- | --- | --- | --- | --- |
| `groq` | api.groq.com | `openai/gpt-oss-120b` | `GROQ_API_KEY` | Default. `reasoning: "medium"`. See [groq-models.md](groq-models.md). |
| `google` | Gemini API (`@ai-sdk/google`) | `gemini-3.5-flash-lite` | `GOOGLE_GENERATIVE_AI_API_KEY` | The free tier trains on prompts outside the EU/UK/EEA. |
| `cerebras` | api.cerebras.ai | `gpt-oss-120b` | `CEREBRAS_API_KEY` | $5 trial credit, card required. |
| `openrouter` | openrouter.ai | _(user picks)_ | `OPENROUTER_API_KEY` | `:free` models are capped at 50 requests/day. |
| `ollama` | `OLLAMA_BASE_URL` or localhost:11434 | `gpt-oss:20b` | none | Fully local. Nothing leaves the machine. |
| `custom` | user-supplied | user-supplied | `CUSTOM_API_KEY` | Any OpenAI-compatible endpoint (LM Studio, vLLM, …). |

Only Groq has been benchmarked against the forced `generate_turn` tool call. Other providers and local models may handle forced tool calls less reliably; test them before recommending one.

### Security notes

- **Self-hosted mode trusts the browser.** It accepts API keys and, for `ollama` and `custom`, arbitrary base URLs from the client, so the server makes outbound requests wherever the browser says. That's fine on your own machine, but don't expose a self-hosted instance to the internet or an untrusted network. `docker-compose.yml` binds to `127.0.0.1` for this reason.
- **Hosted mode trusts only its own env.** `resolveModel("hosted", …)` drops client settings entirely, so customers can't redirect the operator's server or spend someone else's key (covered in `lib/providers.test.ts`).
- **Browser key storage.** Keys saved in Settings sit in that browser's `localStorage` (`store/useSettingsStore.ts`) and travel to the ReadyState server in each request body, for provider authentication rather than conversation text. Explicit full backups include browser-saved keys only in password-encrypted files/copies, never server/environment keys. Live privacy mappings remain memory-only unless deliberately preserved in a local exercise snapshot or encrypted full backup; local exercise history itself is unencrypted.

## Running self-hosted

```bash
# Docker
docker compose up -d            # http://localhost:3000

# Node 24 (conda env optional: environment.yml)
npm ci && npm run build && npm start
```

Keys can be set in `.env.local` (picked up by both), passed as container env, or entered in the Settings panel. The image is a multi-stage `node:24-alpine` build of the Next.js standalone output (~300 MB) and runs as a non-root user.

## Building out the hosted service

The integration points already exist. What's left is account setup and implementation:

1. **Auth:** implement `authenticate` in `lib/hosted.ts` with Supabase Auth, verifying the request's session token and returning `{ userId }`. Add sign-in UI that shows when `/api/config` reports `mode: "hosted"`.
2. **Plans and quota:** `supabase/migrations/20261027010000_create_billing.sql` creates `subscriptions` (plan, status, credits, period end) and `usage_events`. Only the service role writes, and users can read their own rows. `checkQuota` reads `subscriptions`.
3. **Metering:** `recordUsage` inserts into `usage_events` (and decrements credits for pay-per-use plans). It's already called from `onFinish` with phase, provider and token counts.
4. **Billing:** Stripe Checkout for sign-up, plus a webhook route (`app/api/billing/webhook`) that verifies signatures and upserts `subscriptions`.
5. **Operations:** use a paid Groq tier (higher limits, no training on data), per-user rate limiting, and optionally Prompt Guard screening of participant input.

**Cost basis:** at gpt-oss-120b list prices ($0.15 in / $0.60 out per 1M tokens) and the measured compact-prompt sizes, a 12-turn exercise costs roughly **$0.01** in model usage. That's an estimate, not billed data.

## Desktop and mobile (planned)

Both reuse the same server and API contract rather than forking the app.

- **Desktop:** wrap the standalone server (`.next/standalone/server.js`) in a Tauri or Electron shell that starts it on a free localhost port and opens a webview. Self-hosted mode, the Settings panel and Ollama support all work unchanged. The remaining work is native packaging, code signing and auto-update per OS.
- **Mobile:** `app/manifest.ts` already makes the web UI installable as a PWA, which covers phones today. A native app (e.g. Expo / React Native) would be a thin client over the existing endpoints:
  - `GET /api/config` and `POST /api/ttx`, with the UI-message stream protocol from the AI SDK.
  - Privacy masking must stay on-device. `utils/obfuscator.ts` (compromise) and `lib/ttx.ts` are plain TypeScript with no DOM dependency, so move them to a shared package when a second client exists.
  - Phones can't run the server, so mobile users would either point the app at their self-hosted URL or sign in to the hosted service. The hosted service is the main path for mobile.
