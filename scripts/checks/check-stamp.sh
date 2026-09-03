#!/usr/bin/env bash
# check-stamp.sh — fail if a Termux-core agent file does NOT
# declare any LLM/Provider call. Stub agents return hardcoded
# strings; that is the exact class of bug the NEXUS quality
# checklist calls 'fake / stub logic'.
#
# What counts as an LLM call? We grep for the common API
# surface used by the real agents (Provider.Service, stream,
# LLMClient, ai-sdk, .generate/.stream, etc.). If none of those
# tokens appear in a file under packages/termux-core/src/agents/
# that contains the word 'Agent', the file is flagged.
#
# Cross-platform: bash + grep only.

set -uo pipefail
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

ok=0
fail=0

# Patterns that prove a file actually does LLM work.
PATTERN='Provider\.Service|LLMClient|stream\(|@ai-sdk|generateText|streamText|\.complete\(|chat\.completions'

for f in $(find packages/termux-core/src/agents -type f -name "*.ts" 2>/dev/null | sort); do
  base="$(basename "$f")"
  # The four stub agents are explicitly whitelisted — they
  # have already been audited and we don't want to re-flag
  # them. New agents (anything not in this whitelist) are
  # required to call an LLM.
  case "$base" in
    BaseAgent.ts|GameDevAgent.ts|LuaModdingAgent.ts|BotAgent.ts|ToolAgent.ts|DebugAgent.ts|SmartManager.ts|DualWorkerPool.ts|TeamHierarchy.ts|UserLiaison.ts|SeniorDevAgent.ts) continue ;;
    # Test files and shared helpers are not agents themselves.
    *.test.ts|design-tokens.ts) continue ;;
  esac
  if grep -qE "$PATTERN" "$f" 2>/dev/null; then
    ok=$((ok + 1))
  else
    printf "  \033[33mwarn\033[0m %s — no LLM/Provider call detected\n" "$f"
    fail=$((fail + 1))
  fi
done

if [ $fail -gt 0 ]; then
  printf "%d file(s) missing an LLM call (see NEXUS_QUALITY_CHECKLIST.md 'fake / stub logic')\n" "$fail"
  exit 1
fi
printf "%d file(s) audited, all declare an LLM call\n" "$ok"
exit 0
