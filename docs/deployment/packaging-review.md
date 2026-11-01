# Local packaging review

## Current image-processing scope

The app has no Sharp or `next/image` consumer. A supported configuration now
disables image optimization and uses documented, narrow build trace exclusions
for the unused Sharp/platform dependency stack. Local Windows, WSL Ubuntu and
Docker builds exclude native/WASM image processors; static SVG and disabled
optimizer checks validate the intended behavior without deleting traced files.
See [scope and historical component record](binary-components.md).
Remote new-head archive CI and config review remain required; binary publishing
stays disabled. Historical Sharp-containing artifacts are not cleared by this
change.

## Source and S2

The packaging branch starts at `979b58f1f00ba775b0da93fc32b2c302c6896433`,
the merge of [S2 PR #25](https://github.com/tescolopio/ReadyState/pull/25).
That merge is an ancestor of the packaging branch. The original development
previews therefore **include S2**, including the final retry/focus/whole-word
masking fixes. They were built from a dirty packaging worktree, not a reviewed
packaging commit; their manifest marks `uncommittedChanges: true`.

Do not distribute those previews as reviewed releases. The draft PR's remote
workflow builds new candidate archives from its checked-out source revision,
extracts them elsewhere, and records hashes. After review, rebuild at the
approved clean commit and retain its source revision and SHA-256 values.
Do not relabel existing archive hashes as evidence for a newer commit.

Original development-preview SHA-256 values (not rebuilt review candidates):

```text
6151211e5cf300e0b5d82e104128a8136bf00ccc437a9275244171efd60eedd9  ReadyState-0.1.0-windows-x64.zip
058a7b7f2b373245516a972d815cb5291fa494768d3ee87b92ec1d7dc067aabd  ReadyState-0.1.0-linux-x64.tar.gz
```

## Tested platform matrix

| Target | Local evidence | Remaining gaps |
| --- | --- | --- |
| Windows x64 / Node 24.13.0 | Production standalone, relocated ZIP, per-user script install and Start menu shortcut, installed server, removal | Clean Windows machine, actual shortcut/browser-opening UX, signing and organizational PowerShell policies |
| Ubuntu 24.04 under WSL2 / Node 24.13.0 | Native glibc build/startup, relocated tar.gz, per-user script install/application entry, installed server and shortcut removal | Independent Linux machines, graphical desktop UX, other distributions |
| Docker Desktop's Linux environment on Windows | Production image, loopback-only Compose, key-free configuration, pages/assets, notices | Independent Linux Docker Engine |
| Ubuntu WSL Compose client | Same Docker Desktop daemon, configuration and six page GETs | Not independent Linux Engine evidence |
| GitHub-hosted Ubuntu 24.04 x64 / Node 24.13.0 | Remote native build, archive extraction, per-user install/remove, assets and clean shutdown at `df80b5e` | Adds coverage beyond local WSL; not independent Linux Engine or end-user desktop behavior |
| GitHub-hosted Windows x64 / Node 24.13.0 | Same remote archive/lifecycle checks at `df80b5e` | Hosted automation, not clean end-user desktop certification |

Native no-call smokes check six pages and static assets, key-free self-hosted
configuration, refusal of a second instance on the same port, clean launcher
exit and release of the owned server port. No exercise inference is performed.
These checks do not establish complete exercise behavior or model suitability.
Remote workflow results must be recorded on the PR when available, rather than
being inferred from local tests.

## Artifact and installation behavior

- Windows ZIP / Linux tar.gz contain the standalone server, static/public
  assets, native traced dependencies, a Node executable and its license,
  launch/install/uninstall scripts, empty configuration example, install guide,
  ReadyState license, dependency/font notices and source manifest.
- Per-user script installers copy the entire bundle and create a normal-browser
  shortcut. They do not install a model, register a service, require root/admin,
  or provide MSI/EXE packages or automatic updates.
- Existing destinations/shortcuts and nested source-directory installations are
  refused. Stop and move the old installation aside to update.
- Windows removal can delete known package files and its own shortcut; Linux
  removes its own shortcut and prints the directory for manual removal.
  Browser household/settings/plan storage is untouched in both cases.
- Keep the same browser/profile and `http://localhost:3000` origin to preserve
  browser data. No silent fallback to another port is allowed.

## Content checks

[Package inspection](../../scripts/local/inspect.mjs) rejects environment files,
developer configuration directories, evaluation output paths, test files,
logs, private-key files and symlinks. It scans all file bytes for supplied
secret-environment values and known provider/private-key signatures without
printing the values. Tests prove rejection using synthetic values.

Remote builds deliberately receive synthetic credential/environment canaries;
inspection runs on both the assembled package and the actual archive extraction.
The config/startup smoke strips provider variables and skips environment files.
No `/api/ttx` request, model download or paid evaluation is made.

These are specific, testable exclusion checks, not a claim that arbitrary
secrets can always be detected. Review public assets and changes to build-time
environment usage before every release. Never set real keys in package CI.

## Dependency and license assessment (2026-11-01)

`npm audit --omit=dev --json` reports **zero production advisories** at review
time. The complete lockfile audit reports **16 moderate development-tooling
findings**, rooted in minimatch glob amplification:
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
Affected paths run through ESLint/Next lint tooling and TypeScript ESLint.
The local traced runtime inventory does not contain minimatch or ESLint.
This is dependency evidence, not a full vulnerability assessment or assurance
about Node/container OS dependencies. Do not apply `npm audit fix --force`:
its proposed major-version downgrades are unsuitable for this packaging change.
Track the development-tooling advisories separately.

The original Windows runtime inventory has 67 packages, with six absent
standalone notice files. All six are now handled explicitly:

| Package | License | Resolution |
| --- | --- | --- |
| `@next/env` 16.4.3 | MIT | Copy the same-version Next.js root license; verify version/license equality |
| `client-only` 0.0.1 | MIT | Include the React upstream shared root license; marker package's MIT declaration matches; source pinned in supplement manifest |
| `@edge-runtime/cookies` 6.0.0 | MIT | Upstream root license from the exact package release tag |
| `@edge-runtime/primitives` 6.0.0 | MIT | Same upstream release commit |
| `@edge-runtime/ponyfill` 4.0.0 | MIT | Same upstream release commit |
| Next-vendored `string-hash` (no version metadata) | CC0-1.0 | Include the upstream README's explicit Dark Sky copyright waiver; record the version as unknown, not guessed |

Edge Runtime's three annotated package tags resolve to commit
`440c123a37284d6a852ce453af810ad484ecfc01`. The supplement manifest records
immutable source URLs and matches package name, version and license; unknown
missing notices fail packaging instead of silently proceeding.
See [supplement manifest](../../scripts/local/license-supplements.json) and
[notice collector](../../scripts/local/notices.mjs). Existing notices from
installed dependencies are copied too; each artifact carries its own
`app/THIRD-PARTY.json` including provenance.

Inter, Source Sans 3 and Source Serif 4 carry their SIL Open Font License
files under `public/licenses`. The runtime carries the full license from the
exact bundled Node release, including Node's third-party notices.
ReadyState is AGPL-3.0-only; publish corresponding source for the final artifact,
including modifications. License collection and review here are engineering
checks, not legal advice or a complete binary/SBOM audit.

### Additional findings from remote package CI

The [component-by-component record](binary-components.md) lists observed
versions, notice/source locators and conditional redistribution requirements.
It explicitly separates evidence from unresolved source/relinking obligations;
binary redistribution remains uncleared.

The first remote run failed before archive validation. It correctly identified
two libvips platform packages omitted from the original Windows-only notice
assessment: `@img/sharp-libvips-linux-x64` and
`@img/sharp-libvips-linuxmusl-x64` 1.3.4 declare LGPL-3.0-or-later but publish no
license file. The corresponding native Windows and WASM sharp binaries also
declare LGPL terms while their shipped root license contains Apache terms only.
Supplement the full LGPLv3/GPLv3 texts and the exact libvips build release's
third-party table; retain each binary's `versions.json` and mark its
`redistributionReview` as pending in the artifact inventory.

**Binary redistribution is not cleared.** The upstream table is not a complete
set of every constituent copyright notice. Matching binary source, attribution
for all embedded libraries (including WASM-specific resvg/emscripten), and
applicable LGPL source/relinking obligations still require assessment before
release. A passing notice-file/CI check is not legal clearance.

The Windows remote runner also installed sharp's optional WASM artifact.
An unbounded `sk-` regex falsely matched a substring of its embedded SVG
`mask-size` property table. The scanner now requires token boundaries and
provider-shaped lengths; regression tests still reject actual-shaped tokens
inside binary data and captured secret canaries anywhere in a file.

## Gates still open

1. Draft PR code review and final Windows/Linux archive CI.
2. Binary dependency redistribution/source/attribution review described above.
3. Rebuild from the reviewed clean source revision; publish source and hashes
   together only with separate release approval.
4. Independent Linux Engine / clean-machine desktop validation, signing and
   actual shortcut/browser-opening UX.
5. Complete exercise/provider behavior, multi-turn/debrief quality and remaining
   real-phone/Safari/Firefox coverage.

Vercel remains paused. Ollama remains experimental: **ReadyState runs locally**
does not mean **the selected model runs locally**. A configured cloud provider
still receives approved masked text. The prior `gpt-oss:20b` trial configuration
remains unsuitable; no further model inference or downloads are authorized.

## Review and artifact access

Code review at `df80b5e`: the requested independent read-only review reported no
significant issues; GitHub's review separately identified four concrete bugs:
logical Linux source paths bypassed nested-install guards through aliases,
logical uninstall paths missed owned shortcuts through aliases, Windows
substring ownership removed sibling shortcuts, and a referenced browser opener
could outlive/block server shutdown. These require targeted fixes and tests,
then re-review of the new head rather than reusing the earlier assessment.

The repository is public. CI binary artifacts were accessible to signed-in
readers; anonymous API download returning 401 did not make them private.
With user approval, binary artifact IDs `13092860898` and `13092781704` from
run `41329116910` were deleted and the API confirmed zero remaining artifacts
for that run. Previous downloads cannot be recalled. CI now uploads **only
build manifests and checksums**, while still assembling/extracting/testing
archives on runners. Do not restore binary uploads until redistribution clears.

Vercel settings, preview protection and provider keys were not inspected in
this local-only follow-up, per the user's clarification. No inference occurred.
