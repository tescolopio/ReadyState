#!/bin/sh
set -eu
base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$base/runtime/node" "$base/launch.mjs" --open-browser "$@"
