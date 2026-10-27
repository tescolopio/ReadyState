# Groq models

ReadyState calls Groq through the OpenAI-compatible Chat Completions API (`lib/groq.ts`). This page records which models are usable, how they performed on the TTX turn schema, and the rate limits that shape the game loop.

_Last verified: 2026-10-27, against a self-serve (`on_demand`) API key._

## Available models

Groq's [model list](https://console.groq.com/docs/models) is broader than what a self-serve key can call. Llama 3.3 70B, Llama 3.1 8B, MiniMax M2.7 and Muse Spark Open are listed as "Contact sales (Enterprise)" and return `404 model_not_found`. Check what a key can actually use with:

```bash
curl -s https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"
```

Chat models available to a self-serve key:

| Model | Status | Price / 1M tokens (in / out) | Context | Max output | `reasoning_effort` |
| --- | --- | --- | --- | --- | --- |
| `openai/gpt-oss-120b` (**default**) | Production | $0.15 / $0.60 | 131,072 | 65,536 | `low`, `medium`, `high` |
| `openai/gpt-oss-20b` | Production | $0.075 / $0.30 | 131,072 | 65,536 | `low`, `medium`, `high` |
| `qwen/qwen3.8-27b` | Preview | $0.80 / $4.00 | 131,072 | 16,384 | `none`, `default`, `low`, `medium`, `high` |
| `openai/gpt-oss-safeguard-20b` | Preview | $0.075 / $0.30 | 131,072 | 65,536 | Safety classifier, not for gameplay |

Preview models can be removed at short notice. Other models on the key: `whisper-large-v3` / `-turbo` (speech-to-text), `canopylabs/orpheus-*` (text-to-speech), and `meta-llama/llama-prompt-guard-2-*` (prompt-injection classifiers).

The default is set in `lib/groq.ts` and can be overridden with `GROQ_MODEL` in `.env.local`.

## Benchmark: forced `generate_turn` call

Each run sent the baseline-phase system prompt, a sanitized household description and the `turnSchema` JSON Schema, with `tool_choice` forcing `generate_turn`. The output was then validated with `turnSchema.safeParse`. Every successful call returned a schema-valid turn and kept the privacy tags (`[Person N]`, `[Location 1]`) verbatim.

| Model / effort | Wall time | Input tokens | Output tokens (reasoning) |
| --- | --- | --- | --- |
| gpt-oss-120b / low | ~1.3 s | 481 | 250–335 (10–85) |
| **gpt-oss-120b / medium** | **~1.1 s** | **481** | **~400 (120–150)** |
| gpt-oss-120b / high | 3.6–5.6 s | 481 | 1,560–2,490 (1,230–2,110) |
| gpt-oss-20b / low–medium | 0.6–1.5 s | 481 | 210–970 (10–730) |
| gpt-oss-20b / high | ~2.1 s | 481 | ~1,580 (~1,320) |
| qwen3.8-27b / none | ~2.0 s | 746 | 430 |
| qwen3.8-27b / medium | ~4.1 s | 746 | 1,250 (620) |

Takeaways:

- **gpt-oss-120b at `medium`** gives the best balance of realism, latency and token cost.
- **gpt-oss-20b** is the fastest and cheapest, but less grounded. One inject had stored water "contaminated by algae".
- **qwen3.8-27b** is slower, 5–7× the price, uses more input tokens for the same prompt, and is preview-only.
- **`high` effort** spends 3–5× the tokens with no visible quality gain for this task.

## Rate limits

Reported in the `x-ratelimit-*` response headers for each model:

| Limit | Value |
| --- | --- |
| Requests per day | 1,000 |
| Tokens per minute | 8,000 (2,000 for `gpt-oss-safeguard-20b`) |

**Tokens per minute is the binding constraint.** Reaching `TARGET_DURATION_HOURS` (72) at 6–12 hour increments takes 6–12 turns, and every request plus its completion counts against the 8,000-token window.

Replaying the full chat history made this unworkable. Every `generate_turn` call appeared twice, once as the tool call and once as its echoed result (`execute: async (input) => input` in `lib/ttx.ts`), so the prompt grew by about 800 tokens per turn and would have passed 8,000 around turn 10.

`/api/ttx` now sends one compact briefing built by `buildExercisePrompt` (`lib/ttx.ts`):

1. The sanitized household baseline.
2. One log line for each earlier turn (clock, participant action, inject, alerts). Older narratives are dropped.
3. The latest turn in full.
4. The participant's pending action.

It also pins `reasoning: "medium"`.

Measured on a live playthrough (estimated at 4 characters per token, excluding the roughly 480-token system prompt and tool schema, which stay constant):

| Call | Replayed chat (before) | Compact briefing (after) |
| --- | --- | --- |
| Baseline | ~51 | ~46 |
| Turn 2 | ~687 | ~327 |
| Turn 3 | ~1,504 | ~571 |
| AAR | ~2,499 | ~792 (−68%) |

Growth is about 230 tokens per turn, mostly the participant's own action text. By extrapolation, a 12-turn game stays near 3.7k tokens per request, including the system prompt, schema and a medium-effort completion. If longer exercises or a paid tier change the budget, the next lever is trimming or summarizing older log lines.

## Parameters via the AI SDK

`@ai-sdk/openai` doesn't recognize Groq model IDs as reasoning models, so parameters pass through unchanged:

- **`reasoning_effort`:** `providerOptions: { openai: { reasoningEffort: "medium" } }`. The options key is `openai` even though the provider is created with `name: "groq"`. If unset, Groq's server default applies.
- **`temperature` / `topP`:** passed through. Groq recommends temperature 0.5–0.7 for reasoning models (default 0.6, `top_p` default 0.95).
- **`include_reasoning`** (gpt-oss) and **`reasoning_format`** (other models) are mutually exclusive. `reasoning_format: "raw"` returns 400 with tool use or JSON mode.

## Schema enforcement

Groq's strict `json_schema` structured outputs (constrained decoding) support gpt-oss-20b/120b, qwen3.8-27b and Muse Spark, but **not together with tool use or streaming**. `/api/ttx` uses streamed, forced tool calls, so arguments are best-effort rather than guaranteed. No invalid output appeared in testing. If one does, the AI SDK marks the part `output-error` and `app/page.tsx` renders its `errorText`.
