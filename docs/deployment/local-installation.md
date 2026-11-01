# Local Windows and Linux installation

ReadyState can run locally without accounts or a hosted service. Hosting the app
locally does **not** make model calls local: the provider selected in Settings
determines where reviewed text goes. Packaging does not resolve the outstanding
accuracy/safety findings. No model is included or downloaded by these installers.

## Supported targets

Initial native packages target **Windows x64 with Node 24** and **Ubuntu 24.04
x64 with Node 24**. Other Linux distributions, ARM64, native mobile apps,
code-signed Windows executable installers, automatic updates and background
services are not certified by this work. Linux needs a graphical desktop and
`xdg-open` to open the browser automatically; on WSL/headless machines open the
printed URL manually. Linux binaries require glibc (not Alpine/musl).

The same bundled package serves two purposes: run from an extracted folder
(portable), or run its per-user installer script to copy it into your user
directory and add a Start menu/application-menu shortcut. These are **script
installers, not MSI/EXE or distribution-manager packages**. No admin/root access,
global Node installation or Electron runtime is needed for bundled packages.

No downloadable GitHub release is published yet. Build from source using the
instructions below until release artifacts and their matching source are
published. Validate artifacts on their own operating system; never copy the
Windows `.next` output into Linux or vice versa.

## Native Node installation from source

Install [Node 24 LTS](https://nodejs.org/en/download), download/clone ReadyState,
then run in PowerShell (Windows) or your shell (Linux):

```text
npm ci
npm run build
npm start
```

Open **http://localhost:3000/journal**. The production launcher copies standalone
static/public assets, binds only to `127.0.0.1`, and fails visibly if the port is
occupied. Keep the terminal open; Ctrl+C stops ReadyState. For development use
`npm run dev` instead; development is not the release runtime.

All provider configuration is optional. Windows:

```powershell
Copy-Item .env.example .env.local
# Edit .env.local only if server-side provider configuration is wanted.
```

Linux:

```sh
cp .env.example .env.local
```

Alternatively configure the provider in Settings. Keys entered there reach
ReadyState's local server for provider authentication, not conversation text.
There is no model call just from installing, starting, viewing configuration or
editing a household. Do not approve a review or request a debrief during no-call
verification.

## Portable bundles and per-user installers

Extract the entire matching archive into a directory you trust. Keep `app`,
`runtime` and the launch/install scripts together. Verify the archive's SHA-256
against the release's `SHA256SUMS.txt` before running it.

Windows PowerShell:

```powershell
# If Windows marks downloaded scripts as blocked, inspect the files before
# unblocking these specific scripts. Do not bypass organization policy.
Unblock-File .\start.ps1
Unblock-File .\install.ps1
Unblock-File .\uninstall.ps1
.\start.ps1                         # portable
# Or install without starting or making model calls:
.\install.ps1                      # %LOCALAPPDATA%\ReadyState
```

Linux:

```sh
sh ./start.sh                       # portable
# Or install without starting or making model calls:
sh ./install.sh                     # ~/.local/share/ReadyState
```

Installed shortcuts open a terminal with the server and your normal browser.
Closing/stopping that terminal stops the server; it is not an always-on service.
Browser-opening failures print the URL to open manually.

To configure an extracted/installed bundle, copy `configuration.example` to
`.env.local` beside `launch.mjs`, or set `READYSTATE_ENV_FILE` to an absolute
external configuration path before launching. An explicitly selected missing
configuration file is an error. Files containing secrets are never intended as
release content.

For updates, stop ReadyState and move the old installation aside, then install
the new version. Installers refuse to overwrite existing installations or
shortcuts. Remove the previous shortcut using its uninstall script first.
Back up any separately created configuration file; do not copy old `app` or
`runtime` directories into the new version. There is no automatic updater.

Windows: run `.\uninstall.ps1` to remove its shortcut, or
`.\uninstall.ps1 -RemoveInstallation` to remove the known package files too.
Linux: `sh ./uninstall.sh` removes its own shortcut and prints the specific
installation directory to remove manually after stopping the server.
Uninstalling does **not** clear your browser household/settings/plan storage.

Do not install into a subdirectory of the extracted package itself. The
installer validates this to avoid recursively copying its own output.

## Docker Desktop (Windows) / Docker Engine (Linux)

Install [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/)
with Linux containers on Windows, or
[Docker Engine](https://docs.docker.com/engine/install/ubuntu/) and the Compose
plugin on Linux. From the source directory:

```text
docker compose up --build -d
docker compose logs
docker compose down
```

Open the same **http://localhost:3000/journal** URL. Compose binds its published
port to loopback. It builds from source today; a prebuilt registry image is a
separate publication step. Do not expose an unauthenticated container port to a
network. Standalone `docker run -p 3000:3000` is **not** loopback-only; use
`-p 127.0.0.1:3000:3000`.

Compose optionally reads `.env.local` without baking it into the image.
To update, stop the old container, pull the new source and rebuild.
Container volumes are not backups of browser data.

### Experimental Ollama configuration

Ollama remains experimental. This installation work does not authorize model
downloads or inference. Install/connectivity checks do not establish usable
tool output, performance, safety, multi-turn behavior or debrief quality.
The previously tested `gpt-oss:20b` configuration on the trial Windows machine
is unsuitable: installation/connectivity passed, one warm request completed
inside 55 seconds, but usable tool output and manual content review failed.
Multi-turn and debrief remain untested; this does not rule out other local models.

Native ReadyState uses `http://localhost:11434/v1`; Docker Compose uses
`http://host.docker.internal:11434/v1`. Both addresses are interpreted from
ReadyState's **server**, not the browser. Docker Desktop supplies the host name;
Compose adds a host-gateway mapping for Linux Docker Engine. On Linux a
loopback-only Ollama service may still be unreachable from containers. Do not
solve that by exposing unauthenticated Ollama to your LAN; prefer native
ReadyState or a deliberately isolated Docker network/firewall setup.
Refer to [official Ollama installation](https://docs.ollama.com/download) and
[networking documentation](https://docs.ollama.com/faq). Merely reaching
`/api/tags` is a connectivity check, not a model-readiness test.

If Ollama and a model are already installed, open ReadyState **Settings**,
select **Ollama**, enter the installed model's exact tag, and use the appropriate
`/v1` base URL above. No API key is needed. Saving Settings does not generate
text. For an environment-configured default, set `READYSTATE_PROVIDER=ollama`,
`READYSTATE_MODEL=<installed-tag>` and `OLLAMA_BASE_URL=<server-visible-/v1-URL>`.
Listing existing models with `ollama list` does not perform inference. Model
installation/download and exercise generation require separate authorization
in this assessment.

## Data and stable URLs

Household, Settings and Action plan data live in your browser's local storage.
Use the same browser/profile and exact **http://localhost:3000** origin across
native, portable and Docker updates to retain them. `127.0.0.1` versus
`localhost`, another port, HTTPS, or another browser profile means different
storage. Do not run two variants on the same port. The launcher never silently
selects another port; an intentional override is possible through `PORT`.
Masking ledgers and the active exercise are memory-only.

## Building and validating packages

Build on each target OS with Node 24, using its native dependency installation.
Set `READYSTATE_NODE_LICENSE` to the `LICENSE` from the **exact Node release**
whose executable is running the packaging command. The package copies that
executable and license, ReadyState's license, and a source-revision manifest.
Dependency license/notice files are copied from the full native dependency
installation (Next tracing omits them). `app/THIRD-PARTY.json` inventories the
included packages and their notices; inspect any empty notice entries before
publishing. Unreviewed missing notices now fail packaging; known upstream
supplements are pinned and version/license-matched. Font licenses are included
under `app/public/licenses`. See [Packaging review](packaging-review.md) for the
dependency audit, supplement provenance and remaining gates.
Local dirty-tree builds are marked `uncommittedChanges` in that manifest and
are not publishable release evidence.
Do not reuse a Linux build produced by Alpine for native Ubuntu.

```text
npm ci
npm run build
npm run package:local
```

Output: `dist/ReadyState-<version>-windows-x64` or
`dist/ReadyState-<version>-linux-x64`. Packaging refuses an existing output
directory and excludes `.env*`, logs and PEM files from traced app files.
Move an old output aside before rebuilding.

Archive the **entire folder**, including hidden `.next` files. Windows bsdtar:

```powershell
tar --format zip -cf dist\ReadyState-0.1.0-windows-x64.zip -C dist ReadyState-0.1.0-windows-x64
Get-FileHash dist\ReadyState-0.1.0-windows-x64.zip -Algorithm SHA256
```

Linux:

```sh
tar -czf dist/ReadyState-0.1.0-linux-x64.tar.gz -C dist ReadyState-0.1.0-linux-x64
sha256sum dist/ReadyState-0.1.0-linux-x64.tar.gz
```

Extract elsewhere (including a path with spaces), then run:

```text
node scripts/local/smoke.mjs <absolute-extracted-package-directory>
```

The smoke starts/stops only its own process, strips provider environment
configuration, skips configuration files, checks key-free self-hosted config,
six pages, static assets and port conflicts. It never requests `/api/ttx`.
CI should also exercise installation in temporary user directories.
HTTP/static smokes do not verify browser review/cancellation, provider output,
real-phone/Safari/Firefox coverage or debrief quality. S2's existing intercepted
browser evidence remains separate and should not be called real-provider testing.

## Validation record and release gates

Local no-call checks cover Windows native standalone startup, a Windows ZIP
extracted to a path with spaces, Windows per-user install/shortcut creation and
uninstall; Ubuntu 24.04 on WSL2 native startup, a relocated Linux archive,
per-user install/application-menu entry and shortcut removal; and Docker
Desktop Linux-container Compose startup on Windows. Each app smoke checks
key-free configuration, six pages and their static assets. Native smokes also
reject a second instance on the same port. All test-owned servers are stopped.

Linux CLI Compose uses Docker Desktop's WSL integration on this machine, not an
independently installed Docker Engine daemon. Separate Linux Engine and clean
Windows/Linux desktop machines are still validation gaps. Menu entries are
inspected and installed servers are HTTP-smoked; real desktop double-click,
browser-opening UX and organization-specific PowerShell policy remain manual
checks. The Windows/Linux package workflow is added but its remote run is not
yet evidence until it completes.

Before publishing a release, run that workflow on the final clean source
revision, review its results and the existing dependency/safety findings, then
publish matching source and archive hashes together. Current local bundles are
development previews, not signed or automatically updated releases.

These development previews include S2: their base revision is `979b58f`, the
merge of #25. They are dirty-worktree packaging previews, not artifacts rebuilt
from an approved packaging commit. The draft PR and its remote archive CI are
the next review gate; Vercel and model evaluations remain paused.
