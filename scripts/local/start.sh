#!/bin/sh
set -eu
base=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
exec "$base/runtime/node" "$base/launch.mjs" --open-browser "$@"
