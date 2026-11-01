# Local packaging review

## Current image-processing scope

The app has no Sharp or `next/image` consumer. A supported configuration now
disables image optimization and uses documented, narrow build trace exclusions
for the unused Sharp/platform dependency stack. Local Windows, WSL Ubuntu and
Docker builds exclude native/WASM image processors; static SVG and disabled
optimizer checks validate the intended behavior without deleting traced files.
See [scope and historical component record](binary-components.md).
Final-commit review and archive CI passed; PR #26 was merged as infrastructure
only. Binary publishing stays disabled. Historical Sharp-containing artifacts
remain excluded from distribution. The record below identifies the merged-main
builds and separates current obligations from those historical findings.

## Merged-main installation walkthrough (2026-11-01)

PR #26 merged as `b4f12899a52a76c66f40e84197424649bbe66af4`.
The final PR head `69a53ad45a73344a8db5f77b43cecb889c35723b` had passing
Windows/Ubuntu archive, application/Docker and CodeQL checks. Independent
configuration and installer follow-up reviews reported no significant issues;
the final Docker payload change was reviewed directly, with a passing synthetic
negative asset build. Concrete review findings have fix/verification replies.
This was an infrastructure merge, **not release or binary-upload approval**.

Both local native archives were rebuilt from an isolated, clean checkout of
merged `main`, using Node 24.13.0. Their `release.json` identifies the merge
revision, `uncommittedChanges: false` and `developmentPreview: true`.
The exact archives exercised in the walkthrough have these SHA-256 values:

```text
cd64abf96657443342f76f817d3a62899626af6d6451723cab0ef2761a4c9552  main-ReadyState-windows-x64.zip
9e5765ee33ddbcd7f46cd5120a81bbd407cb1ecc05329b242032456934f6117f  ReadyState-0.1.0-linux-x64.tar.gz
```

These hashes are **not** the separately rebuilt CI archives' hashes.
[Merged-main archive CI](https://github.com/tescolopio/ReadyState/actions/runs/41334039881),
[application/Docker CI](https://github.com/tescolopio/ReadyState/actions/runs/41334039852)
and [CodeQL](https://github.com/tescolopio/ReadyState/actions/runs/41334039431)
also passed. Only two small manifest/checksum artifacts were uploaded, not
archives (558/552 bytes). Their source manifests and distinct checksums were
retained separately.

### Walkthrough evidence and boundaries

| Action | Windows x64 | Linux x64 |
| --- | --- | --- |
| Extract/install | ZIP extracted to a path with spaces; per-user PowerShell install to isolated destination with `-NoShortcut` | tar.gz extracted; shell install with isolated HOME/destination; owned desktop entry created |
| Launch/assets | Installed `start.ps1 --no-env`; six-page/72-asset smoke, static SVG and disabled optimizer passed | Installed `start.sh --no-env`; same native smoke passed |
| Synthetic household/scenario | Explicit setup wizard: one fictional adult, general region, fictional home note; selected Extended power outage | Same user-interface path |
| Review/edit/mask/cancel | Person name absent from outgoing text; copy-only edit; whole-word mask rebuilt preview, discarded copy edits and restored focus; edited again then confirmed going back without sending | Same assertions passed |
| Settings | Saved custom provider, synthetic model name, empty key and inert `http://127.0.0.1:9/v1` endpoint; no endpoint test performed | Same settings |
| Stop/restart | Initial owned process-tree stop; restarted at same origin; final launcher IPC stop exited 0 and endpoint stopped responding | SIGINT to the exact owned launcher PID; clean exit; restarted at same origin; final SIGINT clean exit |
| Saved data | Restart showed exact saved household/settings values; review edits had not modified household | Same assertions passed |
| Uninstall | `-RemoveInstallation` removed named package files and retained unrelated sentinel file | Uninstaller removed only its owned shortcut; manual removal of specifically named package files retained unrelated sentinel |
| Browser data after removal | Exact saved household/settings still readable at the same origin, using intercepted offline HTML, not a running app | Same storage-only check |

The browser pane could not connect (CDP timeout); the walkthrough therefore
used a separate headless installed Microsoft Edge with isolated persistent
profiles. It drove the real installed application's UI, not injected household
or provider state. Before navigation, interception blocked every `/api/ttx`
request and any external browser origin. Each platform recorded **zero attempted
model requests, zero forwarded model requests, and no browser runtime errors**.
Neither Send nor debrief was pressed. Provider keys were unset; no model or
browser download occurred. Restart reused each platform's exact origin
(`127.0.0.1:64321` / `127.0.0.1:41991`) and browser profile.

The privacy ledger and additional always-mask rules are intentionally in memory,
not persisted. Household/provider settings persistence passed; this does not
claim masking rules survive a browser restart. Post-uninstall checks establish
browser storage retention, not continued app availability.

### Observed first-run navigation limitation

Starting a completely empty household directly at `/household` (without
`?setup=1`) closed the wizard after the first adult was added, because the
partially saved profile then satisfied `hasProfile`. This was reproduced on
both native builds and is not a packaging/extraction defect. The explicit
`/household?setup=1` first-run flow passed all six steps; editing an already saved
household is also available. Treat direct-entry wizard continuity as a separate
UI follow-up, not a universally passing first-run experience. No app behavior
was changed during this packaging walkthrough.

### Remaining notices against these artifacts

Both native builds contain 61 package notice records in `app/THIRD-PARTY.json`:
51 MIT declarations, three Apache-2.0, two BSD-3-Clause, two ISC, one CC0-1.0,
one BlueOak-1.0.0, and one missing license declaration (`busboy`).
The vendored busboy `LICENSE` contains the MIT permission/copyright text and is
included; its package metadata does not provide a version or license field.
Forty-nine Next-vendored records lack version metadata. Their containing
Next.js 16.4.3 release is known; independent constituent revision mapping is
not established by this inventory. Do not invent versions or describe that
provenance gap as fully cleared.

The exact Node 24.13.0 license, including third-party notices, is bundled at
`runtime/LICENSE`. ReadyState's AGPL-3.0-only text is at `LICENSE`; corresponding
modified source is identified by the exact merge-revision link. Inter, Source
Sans 3 and Source Serif 4 have bundled SIL OFL notices under
`app/public/licenses`. Source/notice locators for packages lacking separate
upstream files remain in the existing supplement manifest; all recorded notice
files were checked in the extracted archives.

Before any separately authorized release, retain the matching source and build
instructions, verify applicable attribution/source requirements for Node and
Next's embedded constituents, and review remaining interpretation questions
with qualified help where needed. File presence and passing CI are engineering
evidence, not blanket legal clearance. Docker has additional Node/Alpine base-OS
notice and provenance obligations; merged-main Docker CI is runtime evidence,
not a published, pinned-digest container redistribution assessment.

Do not reopen the removed image-stack assessment unless the absence guard
fails or a new consumer needs those components. Old Sharp-containing copies
remain historical, uncleared and excluded from distribution.

### Remaining platform and experience limits

- Local Linux means **Ubuntu 24.04 under WSL**. The UI was controlled by Windows
  Edge against that Linux server, not a Linux graphical desktop browser.
  Hosted Ubuntu archive CI adds native coverage beyond WSL, but neither proves
  independent Linux Docker Engine, other distributions or end-user desktop UX.
- Windows used the no-shortcut installation option. Real Start menu/browser
  opening UX, clean machines, signing, admin/organization PowerShell policies
  and antivirus interaction remain unverified.
- Local Docker evidence remains Docker Desktop's Linux environment. This turn
  adds merged-main remote Docker CI, not a separate graphical Docker installation
  walkthrough or independent Linux Engine certification.
- Headless Edge is not manual desktop usability, Safari, Firefox or phone
  coverage. The supplied shared browser tabs/servers were untouched.
- No model was contacted: complete exercises, real-provider responses,
  multi-turn/debrief quality and accuracy/safety findings remain unverified.
  Ollama is experimental. Vercel was not inspected or changed.

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
| GitHub-hosted Ubuntu 24.04 x64 / Node 24.13.0 | Merged `b4f1289` native build, image-free archive extraction, per-user install/remove, assets and clean shutdown | Adds coverage beyond local WSL; not independent Linux Engine or end-user desktop behavior |
| GitHub-hosted Windows x64 / Node 24.13.0 | Same merged `b4f1289` archive/lifecycle checks | Hosted automation, not clean end-user desktop certification |

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

### Historical findings from Sharp-containing package CI

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

## Current gates still open

1. Separate binary-publication/release authorization; #26 is merged, but uploads
   remain disabled.
2. Remaining runtime attribution/source/provenance obligations identified for
   the merged-main artifacts above, not removed Sharp components.
3. Publish matching source and hashes together only with separate release
   approval; retain the rebuilt development artifacts unchanged.
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
