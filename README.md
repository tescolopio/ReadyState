# ReadyState
ReadyState is a dynamic, AI-powered Tabletop Exercise (TTX) simulator designed for personal and household emergency preparedness.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · Vercel AI SDK (`ai`, `@ai-sdk/react`, `@ai-sdk/openai` → Groq) · Zod · Zustand · compromise · lucide-react · Dexie · Supabase (Tier 2 Cloud Sync).

## Getting started

```bash
npm install
cp .env.example .env.local   # set GROQ_API_KEY
npm run dev                  # http://localhost:3000
```

Scripts: `npm run dev`, `npm run build`, `npm run lint`, `npm test` (Vitest).

## Architecture

| Path | Purpose |
| --- | --- |
| `store/usePrivacyStore.ts` | In-memory Zustand ledger (`entityMap`: tag → real value) with `addMapping` / `clearMappings`. |
| `utils/obfuscator.ts` | `maskInput` (compromise detects people/places → `[Person 1]`, `[Location 1]`) and `unmaskOutput`. |
| `lib/ttx.ts` | Zod schemas for the `generate_turn` and `after_action_report` tools, and `deriveTtxState`, the TTX state machine. |
| `app/api/ttx/route.ts` | `streamText` route that **forces** the tool matching the current phase, so every response is structured JSON. |
| `app/api/chat/route.ts` | Basic free-text streaming route (same Groq provider). |
| `app/page.tsx` | Dark-mode TTX control plane: masked submit, unmasked rendering, critical alerts panel, AAR view. |
| `components/ui/*` | Minimal shadcn/ui-compatible `Button`, `Input`, `Card`, `ScrollArea`, `Badge`. Replace with the real ones via `npx shadcn@latest add button input scroll-area card badge --overwrite`. |
| `supabase/migrations/*` | `sim_logs` table with Row Level Security (users can only insert/read their own rows). |

### Game loop

1. **Baseline** – sanitized household parameters → inciting incident.
2. **Action & Inject** – each action returns `{ narrative_response, time_elapsed, hours_elapsed, new_inject, critical_alerts, scenario_status }`, and the clock advances.
3. **End condition** – the model reports `failed`, or the participant survives `TARGET_DURATION_HOURS` (72).
4. **After-Action Report** – structured grade, strengths, supply gaps and recommendations.

Real names and places never leave the browser: only the masked text is sent to `/api/ttx`, and tags are restored client-side before rendering.
