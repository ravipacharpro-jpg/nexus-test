#!/usr/bin/env bash
# check-license.sh — block any LICENSE change that does not
# carry the ALLOW-LICENSE-CHANGE tag in the commit message.
#
# Rationale (NEXUS_QUALITY_CHECKLIST.md 'Branding'): LICENSE is
# a legal artifact, not a code-style decision. The user
# explicitly opted in to a NEXUS-only copyright on 2026-09-01
# (commit 21ac3e2). The risk is that a future contributor (or
# an auto-update) silently reverts to upstream terms without
# flagging it; this check makes that visible.
#
# Behaviour:
#   - If LICENSE has not changed in HEAD vs HEAD~, exit 0.
#   - If LICENSE has changed AND the latest commit message
#     contains 'ALLOW-LICENSE-CHANGE' anywhere, exit 0.
#   - Otherwise exit 1.
#
# Cross-platform: bash + git + grep only.

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

# Are there staged or HEAD changes to LICENSE?
if git diff --quiet -- LICENSE 2>/dev/null && git diff --cached --quiet -- LICENSE 2>/dev/null; then
  if ! git log -1 --name-only --pretty=format: 2>/dev/null | grep -q '^LICENSE$'; then
    echo "LICENSE not changed in the latest commit — ok"
    exit 0
  fi
fi

msg="$(git log -1 --pretty=format:'%B' 2>/dev/null || true)"
if printf '%s' "$msg" | grep -q "ALLOW-LICENSE-CHANGE"; then
  echo "LICENSE change carries ALLOW-LICENSE-CHANGE tag — ok"
  exit 0
fi

printf "LICENSE was modified but the latest commit message does not contain ALLOW-LICENSE-CHANGE.\n"
printf "If this change is intentional, amend the commit message:\n"
printf "  git commit --amend -m '... ALLOW-LICENSE-CHANGE'\n"
exit 1
