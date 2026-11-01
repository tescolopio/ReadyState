#!/bin/sh
set -eu
base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ ! -f "$base/release.json" ]; then echo "Not a ReadyState installation." >&2; exit 1; fi
if ! grep -q 'https://github.com/tescolopio/ReadyState/tree/' "$base/release.json"; then echo "Unexpected installation marker." >&2; exit 1; fi
desktop="$HOME/.local/share/applications/readystate.desktop"
if [ -f "$desktop" ] && grep -Fq "$base/start.sh" "$desktop"; then rm -- "$desktop"; fi
echo "Shortcut removed. Stop ReadyState, then remove this specific installation: $base"
echo 'Browser household/plan data is not removed.'
