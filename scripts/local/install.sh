#!/bin/sh
set -eu
base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
destination=${1:-"$HOME/.local/share/ReadyState"}
case "$destination" in /*) ;; *) echo "Use an absolute installation path." >&2; exit 1 ;; esac
destination=$(realpath -m -- "$destination")
case "$destination" in "$base"/*) echo "Install outside the extracted package directory." >&2; exit 1 ;; esac
if [ -e "$destination" ]; then
  echo "Destination already exists: $destination. Stop ReadyState and move the old installation aside before upgrading." >&2
  exit 1
fi
if [ ! -f "$base/release.json" ]; then echo "Extract the complete ReadyState package before installing." >&2; exit 1; fi
case "$destination" in *'
'*|*'"'*|*'`'*|*'$'*|*'\'*|*'%'*) echo "Unsupported characters in installation path." >&2; exit 1 ;; esac
desktop="$HOME/.local/share/applications/readystate.desktop"
if [ -e "$desktop" ]; then echo "Existing ReadyState shortcut: $desktop" >&2; exit 1; fi
mkdir -p "$destination"
cp -R "$base/." "$destination/"
chmod +x "$destination/runtime/node" "$destination/start.sh"
mkdir -p "$(dirname "$desktop")"
printf '%s\n' '[Desktop Entry]' 'Type=Application' 'Name=ReadyState' "Exec=sh \"$destination/start.sh\"" 'Terminal=true' 'Categories=Education;' > "$desktop"
echo "ReadyState installed at $destination. Run start.sh or use the application menu."
