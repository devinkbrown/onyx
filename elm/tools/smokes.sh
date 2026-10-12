#!/usr/bin/env bash
# Run every elm/*.smoke.mjs suite (jsdom smokes over the real bundle and
# ports.js; zero network). Prints one FAIL line per failing suite and exits
# non-zero if any failed. Usage: elm/tools/smokes.sh [name-filter]
#   PATH must include the `elm` binary (the smokes that boot the bundle build it).
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
filter="${1:-}"
n=0
failed=0
for s in *.smoke.mjs; do
  [[ -n "$filter" && "$s" != *"$filter"* ]] && continue
  n=$((n + 1))
  if ! timeout 180 node "$s" >/dev/null 2>&1; then
    failed=$((failed + 1))
    echo "FAIL $s"
  fi
done
echo "smoke: $n run, $failed failed"
[[ "$failed" -eq 0 ]]
