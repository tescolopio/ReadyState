# Local models with Ollama

Run both ReadyState and a downloaded model on your Windows or Linux machine.
No model-provider API key is required. Local-model compatibility and exercise
quality are **not yet verified**; this guide is setup guidance and a test plan,
not a recommendation that any model produces safe or accurate advice.

This work is separate from the private Vercel trial and PR #25. Do not run
these evaluations against that trial or a cloud-provider-connected dev server.
Installation checks do not authorize inference: agree on a model, hardware,
download size and bounded test run before downloading or running one.

## 1. Choose hardware and a model

ReadyState's Ollama preset is `gpt-oss:20b`. It is a first test candidate, not a
validated choice. Its model page advertises tool calling and operation with as
little as 16 GB memory; this is not a ReadyState performance guarantee.
Allow additional memory for context, the OS and ReadyState. Confirm the current
download size on the model page and available disk space before pulling it.

An accelerated GPU with sufficient VRAM is preferable. CPU-only or partially
offloaded models may exceed ReadyState's shared **55-second model-work budget**,
especially when loading a model or repairing a debrief. Do not raise that budget
as part of a compatibility test; record a timeout as a failed configuration.

Record the OS, RAM, GPU/VRAM, driver, Ollama version, exact model tag and model
ID, context size, and whether inference runs on CPU, GPU or both. Smaller
tool-capable models may be assessed later; chat capability alone is insufficient
because ReadyState requires structured tool calls.

## 2. Install Ollama

### Windows

Use the [official Windows download](https://ollama.com/download/windows) and
[Windows installation guide](https://docs.ollama.com/windows). Check the current
OS and GPU-driver requirements there. The app normally runs a background server
at `http://127.0.0.1:11434`. Open a new PowerShell terminal after installation:

```powershell
ollama --version
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

These commands check the runtime and installed-model list, not inference.
If the server is unavailable, start the Ollama app. Do not also run
`ollama serve` when the app already owns port 11434.

### Linux

Follow the [official Linux guide](https://docs.ollama.com/linux) for your CPU
architecture and GPU. The official installer is available below; inspect it
before executing it, because it installs software and configures a service:

```bash
curl -fsSL https://ollama.com/install.sh -o ollama-install.sh
less ollama-install.sh
sh ollama-install.sh
rm ollama-install.sh
ollama --version
systemctl status ollama --no-pager
curl -fsS http://127.0.0.1:11434/api/tags
```

For a manual installation without a service, run `ollama serve` in its own
terminal instead. Do not start a second server on the same port.

## 3. Keep inference local and size the context

Ollama can use cloud models even through its local server. Select a downloaded
local model, not a cloud tag, and disable cloud features with
`OLLAMA_NO_CLOUD=1`. Keep its bind address at `127.0.0.1:11434` for native
ReadyState. ReadyState makes the requests from its server, not directly from
the browser; changing browser CORS settings is not needed.

Use `OLLAMA_CONTEXT_LENGTH=16384` as an initial test setting, subject to
hardware capacity. Later-turn briefings plus instructions, tool schemas and
output space can exceed a small default context. Record the actual setting and
memory use; a large advertised model context is not the configured runtime
context.

**Windows:** quit the Ollama tray app, set these user environment variables
through Windows Environment Variables, then relaunch it:

```text
OLLAMA_NO_CLOUD=1
OLLAMA_HOST=127.0.0.1:11434
OLLAMA_CONTEXT_LENGTH=16384
```

**Linux service:** use `sudo systemctl edit ollama` and add:

```ini
[Service]
Environment="OLLAMA_NO_CLOUD=1"
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="OLLAMA_CONTEXT_LENGTH=16384"
```

Then reload and restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

For a manually started server, set those variables in its terminal before
`ollama serve`. See the [official configuration FAQ](https://docs.ollama.com/faq)
for platform-specific configuration and confirmation of local-only mode.
Model downloads still use the internet. Disable cloud features before testing;
do not claim offline operation solely because the endpoint says localhost.

After approval for the download, in either platform's terminal:

```text
ollama pull gpt-oss:20b
ollama list
ollama show gpt-oss:20b
```

Pulling downloads model files; it is not an exercise test.

## 4. Point ReadyState at Ollama

### Native ReadyState on the same machine (recommended first test)

Use Node 24 and the [repository setup](../../README.md#self-hosting). Run
ReadyState on loopback, in a separate terminal:

```text
npm ci
npm run dev -- --hostname 127.0.0.1
```

Open `http://localhost:3000/settings`:

1. Select **Ollama (local)**.
2. Set **Model** to the exact installed tag, initially `gpt-oss:20b`.
3. Set **Base URL** to `http://127.0.0.1:11434/v1`.
4. Save. No API key is required.

Alternatively, configure the server's `.env.local`:

```dotenv
READYSTATE_MODE=self-hosted
READYSTATE_PROVIDER=ollama
READYSTATE_MODEL=gpt-oss:20b
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
```

Restart ReadyState after changing server configuration. Use **Use server
defaults** in Settings to clear earlier browser overrides, or explicitly save
the Ollama settings above. Remove stale `READYSTATE_BASE_URL` overrides and
leave all cloud-provider keys unset on the isolated test server.

### ReadyState in Docker, Ollama on the host

The repository's Compose file sets
`OLLAMA_BASE_URL=http://host.docker.internal:11434/v1` and adds a host-gateway
mapping. Select Ollama and leave its Settings Base URL blank so that the server
uses this value. A browser override of localhost would point at the container
itself, not your host's Ollama.

Verify reachability from inside the ReadyState container without inference:

```text
docker compose exec readystate node -e "fetch(process.env.OLLAMA_BASE_URL + '/models').then(async r => { if (!r.ok) throw new Error('HTTP ' + r.status); console.log(await r.text()); }).catch(e => { console.error(e.message); process.exitCode = 1; })"
```

Docker Desktop and Linux host-gateway networking differ. On Linux, an Ollama
server bound only to host loopback generally cannot be reached through the
bridge gateway. Prefer native ReadyState for the first test. If configuring
container access, restrict Ollama to the intended interface and firewall
clients; its local API has no authentication. Do not broadly expose port 11434,
add a public tunnel, or advertise a tested Docker path until it actually passes
on that platform. ReadyState's port should remain localhost-only too.

### Vercel and phones

A Vercel function's localhost is not the user's PC. The private Vercel trial
cannot reach a user's loopback Ollama service with this configuration.
Do not expose Ollama publicly to work around that.

Phones cannot use this local-server setup without a separate, deliberately
secured connection to a machine running ReadyState and Ollama. Mobile access
and native on-device inference remain separate future work.

## 5. Explicit local-model acceptance tests

Run only after separate authorization for local inference, on an isolated
server with Ollama selected and cloud keys unset. Use fictional households.
The existing eval harness calls the model directly through ReadyState's API;
it does **not** test the browser's review-before-send UI.

### Installation checks (no inference)

- Record `ollama --version`, `ollama list` and `ollama show <model>`.
- Verify `/api/tags` and `/v1/models` from the machine running ReadyState.
- Verify `/api/config` reports self-hosted mode and the expected default
  provider when configured through server environment.
- Verify the browser's selected provider and endpoint, not just server defaults.
- Confirm local-only Ollama configuration. An endpoint check proves
  reachability, not tool-call compatibility or safe exercise output.

### Authorized short run

Run one household for three turns first. Specify **both** provider and model:
`EVAL_MODEL` alone defaults the eval's provider to Groq.

PowerShell:

```powershell
$env:EVAL_BASE_URL = "http://localhost:3000"
$env:EVAL_PROVIDER = "ollama"
$env:EVAL_MODEL = "gpt-oss:20b"
$env:EVAL_ONLY = "alex"
$env:EVAL_TURNS = "3"
$env:EVAL_DELAY_MS = "0"
npm run eval -- scripts/eval/households.eval.ts
```

Linux:

```bash
EVAL_BASE_URL=http://localhost:3000 EVAL_PROVIDER=ollama \
EVAL_MODEL=gpt-oss:20b EVAL_ONLY=alex EVAL_TURNS=3 EVAL_DELAY_MS=0 \
npm run eval -- scripts/eval/households.eval.ts
```

The endpoint comes from the ReadyState server's `OLLAMA_BASE_URL`; the eval
does not offer an `EVAL_BASE_URL` for Ollama itself. Do not use a
password-protected trial server: this harness does not supply trial credentials.
Keep runs sequential. Local inference uses memory, power and time even without
API fees. Stop on unsafe output, context errors or persistent timeouts.

### Full exercise and manual review

If the short run passes, separately agree on the full-run scope. Set
`EVAL_TURNS=14` for one household. A debrief is tested only if the exercise
reaches its end; hitting the turn cap does not establish debrief success.
Then cover Sam (winter storm), Priya (powered-device needs), and the privacy
edge-case household before recommending the model.

Record these outcomes separately:

| Test | Required evidence |
| --- | --- |
| Structured output | `generate_turn` tool results, feedback, options and advancing clock; no empty/plain-text substitutes |
| Privacy | No planted identifiers transmitted; tags retained; review/edit/cancel UI checked separately with intercepted requests |
| Performance | Cold-start and warm-call timings, timeouts, retries and debrief repairs; inspect `ollama ps` for CPU/GPU placement |
| Context | Late turns retain established facts; no context truncation or context-limit failures |
| Completion | The exercise reaches 72 hours and actually delivers a debrief |
| Quality and safety | Manual review of every turn, options and debrief for dangerous advice, invented resources, medical claims and factual contradictions |
| Offline operation | After downloads, an explicitly approved network-restricted run still works; local endpoint configuration alone is insufficient |

The [eval guide](../../scripts/eval/README.md) explains artifacts written under
`eval-results/`, checks, retries and timing counters. Report missing token
metadata as unknown, not zero. Separate delivery success from content quality.
Automated checks do not certify safety; the experimental factual judge is not
a release gate or a runtime safety guarantee.

### Troubleshooting

- **Connection refused:** confirm Ollama is running and test from the
  ReadyState server's network context, especially inside Docker.
- **Model not found:** use the exact `ollama list` tag; downloading is separate
  from selecting a model in ReadyState.
- **Unexpected cloud call:** clear browser provider/endpoint overrides, set
  `EVAL_PROVIDER=ollama`, and verify Ollama cloud features are disabled.
- **Timeout:** record cold versus warm behavior and CPU/GPU placement. Model
  loading shares the request budget; a generic successful Ollama chat does not
  establish ReadyState performance.
- **Invalid tool/schema or missing debrief:** mark compatibility or completion
  failed, keep the synthetic artifacts, and do not label the model supported.
- **Context error:** confirm the runtime context setting and available memory;
  longer context needs more memory and may worsen latency.

## References

- [Ollama downloads](https://ollama.com/download)
- [Windows installation](https://docs.ollama.com/windows)
- [Linux installation](https://docs.ollama.com/linux)
- [GPU compatibility](https://docs.ollama.com/gpu)
- [Configuration, local-only mode, context and networking](https://docs.ollama.com/faq)
- [OpenAI-compatible local endpoint](https://docs.ollama.com/api/openai-compatibility)
- [gpt-oss model tags and hardware guidance](https://ollama.com/library/gpt-oss)
- [ReadyState deployment modes](../architecture/deployment-modes.md)
- [ReadyState live evals](../../scripts/eval/README.md)

## First Windows test: 2026-11-01

An explicitly authorized, bounded Alex test was attempted on Windows 11 with
64 GB RAM and an RTX A3000 Laptop GPU (6 GB VRAM). The official standalone
Ollama 0.40.13 binary had a valid Authenticode signature. It ran on a separate
loopback port, with cloud disabled, 16,384 context and one parallel request.
An existing Ollama 0.17.7 service on the usual port was left unchanged.

Model: `gpt-oss:20b`, ID `f38aa0c53da5`, 20.9B parameters, MXFP4; approximately
13 GB as reported by `ollama list`. `ollama ps` reported approximately 14 GB
loaded and 73%/27% CPU/GPU placement. The model's advertised 131,072 context is
distinct from the configured 16,384 runtime context.

ReadyState revision: `bc04e1e` (documentation branch based on main, not PR #25).
An isolated production server was checked for Ollama selection and unset
cloud-provider keys before running only Alex with `EVAL_TURNS=3`.

**Result: failed on the first, cold-start request after 55,075 ms.** ReadyState
reported its model-budget timeout. Zero turns were delivered; there was no
debrief. The run stopped without additional inference or a larger budget.
CPU offloading was observed, but this run does not isolate loading time from
generation time or establish which was responsible for the timeout.

Token counts and provider-call counters were unavailable. The harness's
summary zeroes and green content categories are not evidence of throughput,
safety, structure or quality when no turn was delivered.

Synthetic artifacts are in the gitignored
`eval-results/2026-11-01T13-23-18-026Z/` directory. Test servers were stopped;
the installed CLI and downloaded model remain available for a separately
authorized follow-up. No paid/cloud model calls were made.

Installation succeeded, but the cold-start exercise failed.
`gpt-oss:20b` on this machine is **not yet validated for ReadyState's
55-second request budget**. Zero delivered turns provide no evidence about
response quality or debrief behavior.
Warm-call performance, structured output, exercise quality, debrief delivery,
network-restricted operation and Linux inference remain unverified.

## Proposed bounded warm-start test (not authorized or executed)

Investigate the installed model before downloading another one. This proposal
does not authorize loading or inference. Keep it separate from PR #25; the
cold-start result does not block the private Vercel trial, and neither path is
fully validated.

### Scope and deadlines

Use the same local model ID, runtime, 16,384 context and synthetic Alex
baseline. Do not change ReadyState's 55-second model-work budget, prompts,
reasoning settings or tool schema. Record the exact ReadyState revision.
Build preparation is separate and involves no model calls.

Proposed maximum automated runtime: **300 seconds**, measured from starting
the isolated helpers through cleanup. Every phase has a hard wall-clock cap:

| Phase | Maximum | Stop condition |
| --- | --- | --- |
| Start helpers and verify configuration | 20 s | Wrong provider/model, cloud enabled, unexpected keys, occupied test port or unhealthy helper |
| Load the model separately | 180 s | Timeout, error, unexpected generated output, or unavailable model |
| Submit one opening turn and consume its complete stream | 60 s | Client deadline; ReadyState still stops model work at 55 s |
| Unload, verify and stop helpers | 20 s | Record unload failure and terminate only test-owned processes |
| Scheduling/teardown reserve | 20 s | Global watchdog enforces the 300 s cap |

Unused phase time is not transferred to extend another phase. If loading
fails, do not submit the opening turn. Manual reading of already captured
synthetic output can occur afterward, with all model processes stopped.

### Load measurement, separate from the exercise

Start only the test-owned Ollama service on its isolated loopback port, with
cloud disabled and one parallel request. Confirm the model is initially
absent from that service's `/api/ps`; leave other Ollama instances untouched.

Make exactly one empty-prompt preload request to Ollama's `/api/generate`,
with `model: "gpt-oss:20b"`, `stream: false`, `keep_alive: "5m"` and
`options: { num_ctx: 16384 }`. Omit conversation text. Empty-prompt preload
is documented in the [Ollama FAQ](https://docs.ollama.com/faq).
It still consumes local compute and requires explicit authorization.

Measure wall time using a monotonic clock. Record returned `load_duration`
and `total_duration` separately, converting nanoseconds to milliseconds;
missing fields are unknown, not zero. Verify completion, empty generated
text and the loaded model/context using `/api/ps`. Record CPU/GPU placement
and available memory. Do not equate HTTP readiness with a loaded model.

The opening request may still reload/reconfigure the model. Check its
runtime logs and any available metrics for that; if it does, label the run
as containing additional load work, not a pure warm-generation measurement.

### One opening turn; no automatic resubmission

Do **not** use `npm run eval` or `sendWithRetries` for this test. That harness
can resubmit after limits or incomplete turns. Do not use the browser's
retry button, send a second opening turn, or request a debrief.

Use a one-shot client to POST a single masked Alex baseline to ReadyState's
`/api/ttx`, consuming the full UI-message stream with a 60-second deadline.
HTTP 200 alone is not success: the stream may contain an error.

ReadyState also has server-side schema retries and AI SDK retry behavior.
One HTTP submission therefore does **not** guarantee one model attempt.
Before execution, prepare a test-only loopback forwarding guard between
ReadyState and Ollama that:

- Allows exactly one `/v1/chat/completions` request to reach Ollama, with
  identical request content and streaming semantics.
- Rejects every subsequent inference request immediately, without forwarding
  it, and counts blocked attempts without logging prompts or credentials.
- Applies bounded upstream cancellation when the client disconnects or the
  deadline expires.

The guard requires no production retry changes. Its forwarding, second-call
rejection and cancellation must be tested using a synthetic upstream before
any model loading. The preload and unload requests go directly to the
isolated Ollama service and are distinct from the one inference allowance.
If the guard cannot enforce these limits, do not run the test.
Any attempted internal retry is recorded as a retry-blocked failure, not
silently permitted or reported as retry-free success.

### Evidence and cleanup

Record preload wall time, opening-request wall time through stream completion,
forwarded/blocked inference counts, errors/timeouts and available token/load
metrics. Validate the final `generate_turn` output against ReadyState's actual
schema: baseline feedback, Hour 0, ongoing status, narrative, inject and
response options. Retain the complete synthetic output for manual review.

Review the opening narrative, options and alerts for usefulness, household
fit, invented equipment, factual contradictions and unsafe advice. If no
valid output arrives, record quality as **not assessed**. No debrief is in
scope, so its behavior remains unverified regardless of the opening result.

In a `finally` cleanup, cancel any outstanding inference, make one empty
request with `keep_alive: 0` to unload the model, and verify absence from
the isolated `/api/ps`. Stop the test-owned ReadyState, guard and Ollama
process trees. If graceful unloading fails, record it and terminate only
those test-owned processes before the global deadline. Leave the installed
model files and unrelated services untouched.

Even a valid, useful opening within 55 seconds establishes only a warm-start
opening on this configuration. Before recommending it, document and verify
the repeatable preload/startup procedure, memory requirements, readiness
checks and failure messaging. Multi-turn behavior, cold startup handling,
debrief quality, Linux and remaining browser coverage stay unverified.

## Authorized warm-opening result: 2026-11-01

The proposed test was explicitly authorized and executed once. The bounded
harness and raw synthetic evidence are retained in the session workspace,
not added to the normal test suite. ReadyState revision: `d9ddf9f`, on the
separate local-model documentation branch. The 55-second budget was unchanged.

Before loading, a synthetic upstream verified that the test guard forwards
the first generation request, preserves its payload and stream, rejects a
second request without forwarding, and cancels upstream on client disconnect.
The real run forwarded **one** generation request; zero subsequent attempts
were made or blocked. Cloud features were disabled on the isolated runtime
and cloud-provider keys were unset on ReadyState.

| Measurement | Result |
| --- | --- |
| Empty-prompt preload wall time | 12,504 ms |
| Preload completion | `done_reason: load`, empty response; no generated text |
| Opening upstream request/stream time | 49,874 ms |
| ReadyState request through complete UI stream | 49,986 ms |
| Total helper startup, load, request and cleanup | 66,636 ms, below 300 seconds |
| Cleanup time | 1,278 ms |
| Generation requests forwarded / blocked | 1 / 0 |
| Token usage reported by ReadyState | 2,056 input; 571 output |
| Server schema retries reported | 0 |
| Complete stream | Yes; HTTP 200 and stream termination, but tool errors |
| Complete valid turn delivered | **No** |

The preload returned no `load_duration` or `total_duration`; their values are
unknown. The opening time is end-to-end generation/streaming wall time, not a
pure token-generation measurement. No per-request load metric was captured,
so additional model reconfiguration/loading during the opening is unknown.
Ollama reported the loaded context as 16,384, approximately 14.1 GB allocated,
and approximately 3.85 GB in VRAM.

The model attempted `generate_turn`, but each of its four `response_options`
was an object containing `option`, rather than the required string.
Offline validation against `turnSchema` confirmed failures at
`response_options[0]` through `[3]`. ReadyState returned tool-input and
tool-output errors, not an accepted turn. The harness's passing test means
its bounds and guard assertions passed, **not** model compatibility.

### Manual review of the rejected raw draft

No participant-ready response was delivered. The captured raw tool input was
reviewed offline after stopping the model:

- "Kitchen appliances turn red" after power loss is unexplained and physically
  inconsistent.
- Stored water "nearing its 24-hour limit" at Hour 0 confuses a one-day supply
  with an expiration timer and implies time already elapsed.
- Phone charge at 15% and poorly insulated walls are asserted without baseline
  support. The absence of a recorded smoke detector becomes confirmed absence.
- Sitting outside and drinking the whole gallon is an exaggerated flawed
  option, weak for constructive beginner practice.
- Shutting windows "to seal the cold air in" is contradictory; setting a timer
  assumes an unestablished resource.
- Borrowing blankets and obtaining water are plausible themes, but the schema
  failure and contradictions make the draft unsuitable as delivered.

The model was unloaded with an empty request and `keep_alive: 0`; `/api/ps`
confirmed no model remained loaded in the isolated service. Test-owned
ReadyState, guard and Ollama process trees were stopped. Existing runtimes
and installed model files were left untouched. No automatic resubmission,
second generation, debrief request or cloud call occurred.

**Conclusion:** this warm request returned within the budget, but failed the
required tool schema. `gpt-oss:20b` on this machine remains **not yet validated
for ReadyState's 55-second request budget and output contract**. No further
inference is authorized by this result. Multi-turn, debrief and Linux behavior
remain unverified; this does not block or certify the private Vercel trial.
