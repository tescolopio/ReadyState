#!/bin/sh
set -eu
base=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
if [ ! -f "$base/release.json" ]; then echo "Not a ReadyState installation." >&2; exit 1; fi
if ! grep -q 'https://github.com/tescolopio/ReadyState/tree/' "$base/release.json"; then echo "Unexpected installation marker." >&2; exit 1; fi
desktop="$HOME/.local/share/applications/readystate.desktop"
if [ -f "$desktop" ] && grep -Fxq "Exec=sh \"$base/start.sh\"" "$desktop"; then
  rm -- "$desktop"
  echo "Owned shortcut removed."
else
  echo "No shortcut owned by this installation was removed."
fi
echo "Stop ReadyState, then remove this specific installation: $base"
echo 'Browser household/plan data is not removed.'
