#!/usr/bin/env bash
# check-capabilities.sh — fail if any partial / stub agent
# is NOT registered in the autofarm capability registry
# (packages/assistant/src/plugins/autofarm/lib/partial-features.ts).
#
# Rationale (NEXUS_QUALITY_CHECKLIST.md 'top suggestion 1'):
# without a registry entry, the UI/CLI has no way to warn the
# user that an agent returns a hardcoded template instead of a
# real model response. This check is the second line of
# defense after the runtime gate in Businessman.warnIfPartialAgent.
#
# Behaviour:
#   - Read every agent id from the whitelist in check-stamp.sh
#     (same list) — those are the partial agents.
#   - For each, grep the partial-features.ts file for the id.
#   - If missing, fail.
#
# Cross-platform: bash + grep only.

set -uo pipefail
# Resolve the repo root: walk up from this script's location
# until we find a directory containing package.json + .git.
find_repo_root() {
  local dir
  dir="$(cd "$(dirname "$1")" && pwd)"
  while [ "$dir" != "/" ]; do
    if [ -f "$dir/package.json" ] && [ -d "$dir/.git" ]; then
      printf '%s' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}
REPO_ROOT="$(find_repo_root "$0")"
if [ -z "$REPO_ROOT" ]; then
  echo "could not locate repo root from $0" >&2
  exit 2
fi
cd "$REPO_ROOT"

REGISTRY="packages/assistant/src/plugins/autofarm/lib/partial-features.ts"

# Partial agent ids the autofarm cares about. Keep this in sync
# with the whitelist in check-stamp.sh.
partial_ids="game-dev-agent lua-modding-agent bot-agent tool-agent"

missing=0
for id in $partial_ids; do
  if grep -qF "\"$id\"" "$REGISTRY" 2>/dev/null; then
    printf "  \033[32mok\033[0m   %s is registered in partial-features.ts\n" "$id"
  else
    printf "  \033[31mFAIL\033[0m %s is NOT registered (add it to %s)\n" "$id" "$REGISTRY"
    missing=$((missing + 1))
  fi
done

if [ $missing -gt 0 ]; then
  printf "%d partial agent(s) missing from the capability registry\n" "$missing"
  exit 1
fi
exit 0
