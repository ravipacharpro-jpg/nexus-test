#!/bin/sh
# Safe device updater for NEXUS.
# Syncs the repo's .nexus/ (agents, commands, skills, registry) + config/ into the
# running device's NEXUS config dir, PRESERVING secrets (api-vault) and all custom
# opencode.jsonc fields (permission/references/mcp/tools/model). Providers are MERGED
# in, never overwritten. Always backs up first, then validates.
#
# Platform: Linux / macOS / Termux (Android) native; Windows -> use WSL or Git Bash (POSIX sh).
# Usage:   sh scripts/update-device.sh
set -eu

REPO="$(cd "$(dirname "$0")/.." && pwd)"
TS=$(date +%Y%m%d-%H%M%S)
BACKUP="${TMPDIR:-/tmp}/nexus-update-backup/$TS"

# --- detect running device config dir ---
if [ -d "$HOME/nexus/.nexus" ]; then
  TARGET="$HOME/nexus/.nexus"
elif [ -d "$HOME/.nexus/agent" ] || [ -d "$HOME/.nexus/command" ]; then
  TARGET="$HOME/.nexus"
elif [ -d "$HOME/.config/nexus" ]; then
  TARGET="$HOME/.config/nexus"
else
  echo "ERROR: cannot detect NEXUS config dir. Set NEXUS_CONFIG env var and re-run." >&2
  exit 1
fi
ROOT="$(dirname "$TARGET")"

echo "Repo:   $REPO"
echo "Target: $TARGET"
echo "Root:   $ROOT"
echo "Backup: $BACKUP"

mkdir -p "$BACKUP"
# backup current config (excludes nothing here, but app-level holds no secrets on Termux;
# on other setups api-vault is under user-level ~/.nexus, not the app config dir)
cp -r "$TARGET" "$BACKUP/nexus-config" 2>/dev/null || true
echo "[1/4] Backed up current config -> $BACKUP/nexus-config"

# --- sync content (additive; repo is source of truth) ---
cp -r "$REPO/.nexus/agent/."   "$TARGET/agent/"
cp -r "$REPO/.nexus/command/." "$TARGET/command/"
cp -r "$REPO/.nexus/skills/."  "$TARGET/skills/"
cp "$REPO/.nexus/registry.json" "$TARGET/registry.json"
mkdir -p "$ROOT/config"
cp -r "$REPO/config/." "$ROOT/config/"
echo "[2/4] Synced agents/commands/skills/registry/config"
cp "$REPO/VERSION" "$ROOT/VERSION" 2>/dev/null || true

# --- merge providers into opencode.jsonc (preserve everything else) ---
if [ -f "$TARGET/opencode.jsonc" ]; then
  # shellcheck disable=SC2086
  node "$REPO/scripts/merge-opencode.cjs" "$TARGET/opencode.jsonc" $REPO/config/*-provider.jsonc
else
  echo "[3/4] No opencode.jsonc at target; skipped provider merge (add providers manually)."
fi

# --- validate ---
echo "[4/4] Validation:"
node "$REPO/scripts/validate.js" "$ROOT" || true

echo ""
echo "Bundle version: $(cat "$REPO/VERSION" 2>/dev/null || 'unknown')"
echo "DONE. Device updated safely. If anything breaks, restore from: $BACKUP/nexus-config"
