# Native/WASM redistribution component record

Assessment date: 2026-11-01. This is an engineering evidence record, **not binary
redistribution clearance**. PR #26 remains draft. Archive validation continues,
but CI uploads only source manifests/checksums while these questions are open.

## Current scope: unused image stack excluded at build time

ReadyState does not import `next/image`, call Sharp or implement image-processing
routes. Its existing static assets do not need the image optimizer. The installed
Next.js guides document both `images.unoptimized: true` (serve images as-is) and
`outputFileTracingExcludes` (exclude unused files from build traces).
`next.config.ts` now uses both: disabling optimization alone still traced Sharp;
the narrow Sharp/`@img/sharp*` exclusions remove its unused native/WASM stack from
the standalone build. No dependency is deleted after tracing or archive assembly.

The global trace key also covers Next's base-server trace; the installed
`collect-build-traces.js` matches exclusion keys against `next-server` as well as
route traces. This is necessary because only excluding page routes leaves the
base-server optimizer dependencies. Glob patterns use `/` as required by the
Next guide, including on Windows.

Local Windows, Ubuntu 24.04 under WSL, and Docker Desktop Linux builds have been
inspected without Sharp, libvips or their WASM platform packages. The no-call
smoke checks that static SVG still serves and `/_next/image` returns 404 instead
of invoking a missing processor, in addition to pages/assets and shutdown.
The package/Docker inspector fails if the excluded stack reappears. Remote
archive validation must pass at the new source revision too.

**The record below is historical for prior Sharp-containing candidates.**
Their source/relinking/attribution questions are not declared solved; those
copies remain uncleared. For image-stack-free new candidates the requirement is
verified absence, not expanded review of components that are not redistributed.
Binary uploads remain disabled. No general license clearance for Node, fonts,
other dependencies or Docker base OS is implied.
If future features need image processing, remove exclusions only after reviewing
the consumer, restoring required dependencies, and resolving redistribution.

## Evidence and interpretation

The component versions below are observed in the published packages'
`versions.json`, including the downloaded CI candidates at `df80b5e`, not
inferred from npm's JavaScript dependency tree. Native Linux uses
`@img/sharp-libvips-linux-x64` 1.3.4, Docker uses its `linuxmusl-x64` counterpart,
Windows uses `@img/sharp-win32-x64` 0.35.5, and remote Windows also traces the
optional `@img/sharp-wasm32` 0.35.5.

- [libvips build release](https://github.com/lovell/sharp-libvips/tree/ebb95f8add54eee8bed840e3fb587e4cbec857d7)
  (`v1.3.4`) supplies the native build recipe, version variables and secondary
  [license table](https://github.com/lovell/sharp-libvips/blob/ebb95f8add54eee8bed840e3fb587e4cbec857d7/THIRD-PARTY-NOTICES.md).
- [Native manifest](https://unpkg.com/@img/sharp-libvips-linux-x64@1.3.4/versions.json)
  and [WASM manifest](https://unpkg.com/@img/sharp-wasm32@0.35.5/versions.json)
  identify components. Each new candidate must be compared against its own
  manifest; Windows is not assumed identical to Linux.
- Full LGPLv3/GPLv3 texts and the pinned secondary notice table are included by
  [the supplement collector](../../scripts/local/notices.mjs), alongside the
  binary's original license and `versions.json`. This does **not** supply all
  constituent copyright notices, corresponding source or a relinking procedure.
- `N` means observed in the native Linux manifest; `W` means observed in WASM.
  It is not a claim that every component is present on every native platform.
  Windows presence is determined from its own `versions.json`.
- Licenses in the table are the build project's secondary attribution unless
  stated otherwise. "Source locator" identifies the upstream project/version to
  inspect, not a project-controlled source mirror or compliant written offer.
  Exact license/notice files and source checksums still need verification.

## Requirement classes

| Class | Applicable redistribution work (conditional on actual license/files) |
| --- | --- |
| P | Preserve each component's copyright/permission/disclaimer and any required notices; confirm the exact version's text and all embedded dependencies |
| A | P plus Apache license/NOTICE handling, change notices where applicable, and any patent-license conditions |
| F | Preserve the FreeType FTL attribution/disclaimer and fulfill its binary documentation acknowledgment conditions; verify the selected license route |
| M | Preserve MPL notices and provide covered-file source as required for executable distribution, including any modifications; unmodified files are not automatically exempt |
| L | Preserve notices/licenses; establish a compliant corresponding-source delivery method for covered libraries, modifications and build scripts; fulfill applicable combined-work/relinking, reverse-engineering and installation-information conditions under the selected LGPL version |
| T | Identify runtime/compiler support actually embedded in output separately from the toolchain; inventory its licenses/notices and source obligations |

For L, replacing an outer `.so` is not proof of relinkability of the components
compiled inside it. A monolithic `.wasm` is not cleared just because LGPL
components are used through JavaScript. Providing license texts or third-party
GitHub links alone does not establish a compliant source offer. See
[LGPLv3 section 4](https://www.gnu.org/licenses/lgpl-3.0.html#section4) and
[GPLv3 section 6](https://www.gnu.org/licenses/gpl-3.0.html#section6).
The exact obligations depend on license version/options and actual linkage.

## Per-component record

All rows remain **open for redistribution** until the corresponding requirement
class and notice/source delivery are evidenced. A version-tag existence check
does not clear a row.

| Component | Observed version | Set | Declared license / class | Source locator | Notice/source action still required |
| --- | --- | --- | --- | --- | --- |
| aom | 3.15.1 | N,W | BSD-2-Clause + AOM Patent License / P | [AOM v3.15.1](https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1) | Collect exact copyright/patent notices and determine enabled codecs |
| libarchive | 3.8.9 | N | BSD-2-Clause / P | [libarchive](https://github.com/libarchive/libarchive) | Verify 3.8.9 source and constituent copyright notices |
| cairo | 1.18.6 | N | MPL-1.1 / M | [cairo](https://gitlab.freedesktop.org/cairo/cairo) | Confirm license route, covered source/files, modifications and delivery |
| cgif | 0.5.4 | N,W | MIT / P | [cgif](https://github.com/dloebl/cgif) | Collect exact 0.5.4 notice/source reference |
| libexif | 0.6.26 | N,W | LGPL via build project's later-version route / L | [libexif](https://github.com/libexif/libexif) | Confirm selected upstream license option, source/build/relink method |
| expat | 2.8.5 | N,W | MIT / P | [expat](https://github.com/libexpat/libexpat) | Collect exact copyright/license text |
| libffi | 3.8.0 | N,W | MIT / P | [libffi source archive](https://github.com/libffi/libffi/releases/download/v3.8.0/libffi-3.8.0.tar.gz) | Recipe URL observed; preserve its notices and source hash |
| fontconfig | 2.18.3 | N | fontconfig BSD-like / P | [fontconfig](https://gitlab.freedesktop.org/fontconfig/fontconfig) | Collect COPYING and copyright at exact source version |
| freetype | 2.14.3 | N | FTL / F | [FreeType VER-2-14-3](https://github.com/freetype/freetype/tree/VER-2-14-3) | Collect FTL, applicable component notices and binary acknowledgment |
| fribidi | 1.0.17 | N | LGPL via build project's later-version route / L | [fribidi](https://github.com/fribidi/fribidi) | Verify upstream option, corresponding source, modifications/linkage |
| GLib | 2.90.0 | N,W | LGPL via build project's later-version route / L | [GLib source archive](https://download.gnome.org/sources/glib/2.90/glib-2.90.0.tar.xz) | Recipe URL observed; source/build scripts and relink path required |
| harfbuzz | 14.5.0 | N | MIT-style / P | [Harfbuzz release](https://github.com/harfbuzz/harfbuzz/releases/tag/14.5.0) | Collect full copyright notice set, not just SPDX label |
| libheif | 1.23.5 | N,W | LGPL / L | [libheif release](https://github.com/strukturag/libheif/releases/tag/v1.23.5) | Verify core/plugin license variants, enabled codecs, source/relink path |
| highway | 1.4.0 | N,W | BSD-3-Clause / P | [highway](https://github.com/google/highway) | Verify exact version and full copyright/license notice |
| libimagequant | 2.4.1 | N,W | BSD-2-Clause fork / P | [build project's libimagequant fork](https://github.com/lovell/libimagequant) | Resolve exact fork source, not another libimagequant license/version |
| Little CMS | 2.19.1 | N,W | MIT / P | [Little CMS](https://github.com/mm2/Little-CMS) | Verify exact source and preserve notice |
| mozjpeg | 0826579 | N,W | zlib / IJG / BSD-3-Clause / P | [mozjpeg commit](https://github.com/mozilla/mozjpeg/commit/0826579) | Expand short hash, retain exact source tree and all combined notices |
| pango | 1.58.2 | N | LGPL via build project's later-version route / L | [pango](https://gitlab.gnome.org/GNOME/pango) | Verify option and source/build/modification/relink requirements |
| pixman | 0.46.4 | N | MIT / P | [pixman](https://gitlab.freedesktop.org/pixman/pixman) | Collect exact contributor copyright/license set |
| libpng | 1.6.58 | N,W | libpng license / P | [libpng](https://github.com/pnggroup/libpng) | Collect version-specific libpng copyright/license text |
| proxy-libintl | 0.5 | N | LGPL via build project's later-version route / L | [proxy-libintl source archive](https://github.com/frida/proxy-libintl/archive/0.5.tar.gz) | Recipe URL observed; selected license, source and build integration open |
| librsvg | 2.63.2 | N | LGPL via build project's later-version route / L | [librsvg](https://gitlab.gnome.org/GNOME/librsvg/-/tree/2.63.2) | Source/build/relink mechanism plus exact Rust Cargo.lock dependencies |
| libtiff | 4.7.2 | N,W | libtiff BSD-like / P | [libtiff](https://gitlab.com/libtiff/libtiff) | Collect full version-specific copyrights/disclaimers |
| libultrahdr | 2.0.2 | N,W | MIT / P | [libultrahdr](https://github.com/google/libultrahdr/tree/v2.0.2) | Verify built codec components and preserve notices |
| libvips | 8.18.7 | N,W | LGPL via build project's later-version route / L | [libvips release](https://github.com/libvips/libvips/releases/tag/v8.18.7) | Primary corresponding-source/build/relink delivery blocker |
| libwebp | 1.6.0 | N,W | New BSD / P | [libwebp](https://chromium.googlesource.com/webm/libwebp/) | Resolve source version/hash and preserve patent/copyright files if applicable |
| libxml2 | 2.15.4 | N | MIT / P | [libxml2](https://gitlab.gnome.org/GNOME/libxml2/-/tree/v2.15.4) | Collect exact license/copyright text and enabled dependencies |
| zlib-ng | 2.3.3 | N,W | zlib / P | [zlib-ng source archive](https://github.com/zlib-ng/zlib-ng/archive/2.3.3.tar.gz) | Recipe URL observed; retain notice and source hash |
| resvg/usvg | 0.48.1 | W | Apache-2.0 OR MIT / A or P | [resvg v0.48.1](https://github.com/linebender/resvg/tree/v0.48.1) | Select license route, preserve notices, inventory locked Rust dependencies |
| Emscripten | 6.0.10 | W toolchain | Toolchain/output-support licenses / T | [Emscripten 6.0.10](https://github.com/emscripten-core/emscripten/tree/6.0.10) | Distinguish build-only code from emitted JS/libc/compiler support and notices |
| sharp | 0.35.5 | N,W | Apache-2.0 (wrapper), composite binary license / A,L | [sharp v0.35.5](https://github.com/lovell/sharp/tree/v0.35.5) | Preserve Apache terms; determine matching combined-object/source/relink support |

Research checked the tag/release/commit locations for aom, freetype, harfbuzz,
libheif, mozjpeg, librsvg, libultrahdr, libvips, libxml2, resvg and Emscripten.
For remaining rows, upstream projects/versions are locators requiring an exact
source/license check, not claimed completed verification. resvg's Cargo.toml
license was inspected; its full transitive lockfile was not assessed.

## Questions answered versus unresolved

**Answered:** JavaScript dependency notices alone omit bundled native/WASM
components. The native Linux package inspected contains one consolidated
`libvips-cpp.so`, not a separate shared library for every component. The WASM
package inspected contains the final `.wasm`, index/glue, version metadata and
Apache-only root license; it does not contain relinkable application objects or
corresponding source. The native secondary notice table omits resvg and
Emscripten-output support. Both native and WASM require further work.

**Not established:** internal native linkage, a compliant matching source
delivery route, objects/procedure to modify and relink the WASM combined work,
all constituent notices, Windows-specific source/build provenance, resvg and
librsvg Rust transitive notices, or emitted toolchain-support completeness.
Public upstream source locations alone do not close these questions.

The pinned [POSIX build script](https://github.com/lovell/sharp-libvips/blob/ebb95f8add54eee8bed840e3fb587e4cbec857d7/build/posix.sh)
is source-mapping evidence, not a complete corresponding-source bundle.
The [WASM build script](https://github.com/lovell/sharp-libvips/blob/ebb95f8add54eee8bed840e3fb587e4cbec857d7/build/wasm.sh)
requires identification of the actual `wasm-vips` revision used by the published
development artifact; a floating/default `HEAD` is not sufficient.

## Closure criteria before archive redistribution

1. Bind each artifact's platform `versions.json` to an exact build/provenance
   record, source tree/archive hashes and complete dependency inventory.
2. Preserve each row's actual notices/licenses, including Rust and emitted
   runtime dependencies not listed in `versions.json`.
3. Select and implement a compliant source-delivery method for copyleft code,
   including modifications/build scripts; retain it for the required period.
4. Demonstrate modification/relinking of each relevant combined binary with
   source or object material and installation instructions as applicable.
5. Obtain review of this record and those delivery mechanisms. Only then
   remove pending `redistributionReview` flags and enable binary upload.

Until then, CI can rebuild/test candidates on hosted runners and publish
non-binary source manifests/checksums. Existing local preview copies stay
development-only; access labels do not replace legal clearance.
