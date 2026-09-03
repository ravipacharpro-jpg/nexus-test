#!/usr/bin/env bash
# NEXUS v0.1.72 smoke test — no deps, pure shell + node.
set -uo pipefail
REPO="$HOME/nexus-agent"
NEXUS_HOME="$HOME/.nexus"
FAILS=0
PASSES=0
check() {
  local name="$1" cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    printf "  ✓ %s\n" "$name"; PASSES=$((PASSES+1))
  else
    printf "  ✗ %s\n" "$name"; FAILS=$((FAILS+1))
  fi
}
echo "NEXUS v0.1.72 smoke test"
echo "========================"
echo "[1/5] Repo integrity"
check "VERSION file present" "[ -f \"$REPO/VERSION\" ]"
check "VERSION reads 0.1.72" "grep -q '^v0\\.1\\.72$' \"$REPO/VERSION\""
check "package.json reads 0.1.72" "grep -q '\"version\": \"0\\.1\\.72\"' \"$REPO/package.json\""
check "Git clean" "cd \"$REPO\" && git diff --quiet HEAD"
echo "[2/5] Autofarm library"
for f in loop-audit.ts marketplace.ts top3-models.ts vault-summary.ts health-check.ts playwright-stealth.ts vault-key-rotation.ts model-fallback.ts nexus-memory.ts quackr.ts doctor.ts review.ts; do
  check "$f" "[ -f \"$REPO/packages/assistant/src/plugins/autofarm/lib/$f\" ]"
done
echo "[3/5] TUI components"
for f in status-bar.tsx dialog-onboarding.tsx dialog-vault.tsx dialog-web.tsx; do
  check "$f" "[ -f \"$REPO/packages/tui/src/component/$f\" ]"
done
check "humanizeError" "[ -f \"$REPO/packages/tui/src/util/error.ts\" ]"
echo "[4/5] User vault"
check "Vault dir" "[ -d \"$NEXUS_HOME\" ]"
check "api-vault.json valid" "node -e \"JSON.parse(require('fs').readFileSync('$NEXUS_HOME/api-vault.json','utf8'))\""
echo "[5/5] Runtime"
check "bun installed" "command -v bun"
check "node installed" "command -v node"
echo "========================"
printf "Passes: %d  Fails: %d\n" "$PASSES" "$FAILS"
[ "$FAILS" -eq 0 ] && exit 0 || exit 1
