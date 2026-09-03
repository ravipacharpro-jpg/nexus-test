#!/usr/bin/env bash
# ci-checks.sh — single entry point for every quality gate the
# NEXUS repo enforces locally. Run via 'bun run check:all' or
# directly: bash scripts/ci-checks.sh
#
# The script is intentionally short and non-fatal at the
# info level — sub-checks emit warnings so the developer can
# see what would have failed in CI without the local build
# grinding to a halt. Pass --strict to fail on any warning.
#
# Checks (each one is a separate file under scripts/checks/):
#   1. check-stamp.sh       - LLM-call audit on agent files
#   2. check-license.sh    - block LICENSE change without tag
#   3. check-capabilities.sh - partial agents are registered
#
# Cross-platform: bash + grep + awk only. No deps. Works on
# Termux, Linux, macOS, Git-Bash on Windows.

set -uo pipefail

cd "$(dirname "$0")/.."

STRICT=0
if [ "${1:-}" = "--strict" ]; then STRICT=1; fi

ok()   { printf "  \033[32mok\033[0m   %s\n" "$*"; }
warn() { printf "  \033[33mwarn\033[0m %s\n" "$*"; }
fail() { printf "  \033[31mfail\033[0m %s\n" "$*"; }
hdr()  { printf "\n== %s ==\n" "$*"; }

failed=0

hdr "1/3 LLM-call audit (agent files must call a provider)"
if bash scripts/checks/check-stamp.sh; then
  ok "agent files declare an LLM call"
else
  fail "agent files do NOT declare an LLM call"
  failed=$((failed + 1))
fi

hdr "2/3 LICENSE change guard"
if bash scripts/checks/check-license.sh; then
  ok "LICENSE ok (or change carries ALLOW-LICENSE-CHANGE tag)"
else
  fail "LICENSE changed without ALLOW-LICENSE-CHANGE tag — see scripts/checks/check-license.sh"
  failed=$((failed + 1))
fi

hdr "3/3 Capability registry (partial agents must be registered)"
if bash scripts/checks/check-capabilities.sh; then
  ok "all partial agents are registered in partial-features.ts"
else
  warn "some partial agents are not yet registered (run: see /sdcard/prompt.cpp top suggestion 1)"
  if [ "$STRICT" = "1" ]; then failed=$((failed + 1)); fi
fi

printf "\n"
if [ $failed -gt 0 ]; then
  printf "\033[31m%d check(s) failed\033[0m\n" "$failed"
  exit 1
fi
printf "\033[32mall checks passed\033[0m\n"
