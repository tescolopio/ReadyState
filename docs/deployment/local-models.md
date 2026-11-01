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

Status: documentation checked against provider resolution and eval settings;
no Ollama download, installation, inference or local-model certification has
been performed for this guide. Windows/Linux model quality and performance
remain unverified.
