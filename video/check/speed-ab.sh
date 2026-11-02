#!/bin/sh
# Test helper: alternates speed runs so a busy machine affects each case alike. Run from the repo root with
# PROJECTS_DIR and BETTERVID_CHROME set. Usage: sh video/check/speed-ab.sh <rounds> <first> <last> <case> [<case> ...]
# A case is a project folder, or INLINE:<folder> to keep the engine scene in the props.
rounds=$1; first=$2; last=$3; shift 3
i=0
while [ "$i" -lt "$rounds" ]; do
  for c in "$@"; do
    case "$c" in
      INLINE:*) INLINE=1 node --experimental-strip-types video/check/speed.ts "${c#INLINE:}" "$first" "$last" 2>&1 | grep "frames/s" | sed 's/^/inline /' ;;
      *) node --experimental-strip-types video/check/speed.ts "$c" "$first" "$last" 2>&1 | grep -E "frames/s|Error" | head -3 ;;
    esac
    uptime | sed 's/.*load averages*: /  load /'
  done
  i=$((i + 1))
done
