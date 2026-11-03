#!/bin/sh
# Runs one project's stages from a given one onward, each alone with --only, so earlier stages are never rerun even when
# a change to the engine's abilities would make their cache keys differ. Stops at the first stage that fails.
# Usage: sh scripts/run-from.sh <projectId> <stage> [<stage> ...]
id="$1"
shift
for s in "$@"; do
  echo "== $s"
  npm run -s pipeline -- "$id" --only "$s" || { echo "STAGE FAILED: $s"; exit 1; }
done
