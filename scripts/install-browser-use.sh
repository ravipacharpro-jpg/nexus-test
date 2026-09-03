#!/usr/bin/env bash
# install-browser-use.sh — install the browser-use Python MCP
# server so autofarm can drive a full Chromium browser from
# Termux, Linux, macOS or Windows (WSL).
#
# What this does:
#   1. Detects the platform (Termux / Linux / macOS / WSL).
#   2. Installs Python 3.11+ if missing (apt / brew / pkg).
#   3. Installs uv (fast Python package manager) if missing.
#   4. Creates a venv at ~/.nexus/autofarm/.venv
#   5. Installs browser-use inside the venv.
#   6. Symlinks the binary into ~/.local/bin/ so the MCP server
#      command "browser-use" is on PATH for NEXUS.
#   7. Verifies with `browser-use --version`.
#
# Usage:
#   bash scripts/install-browser-use.sh
#   NEXUS_BROWSER_USE_DIR=/custom/path bash scripts/install-browser-use.sh
#
# Safe to re-run.

set -euo pipefail

NEXUS_BROWSER_USE_DIR="${NEXUS_BROWSER_USE_DIR:-$HOME/.nexus/autofarm}"
VENV_DIR="$NEXUS_BROWSER_USE_DIR/.venv"
LOCAL_BIN="$HOME/.local/bin"

log() { printf "[install-browser-use] %s\n" "$*"; }
fail() { printf "[install-browser-use][error] %s\n" "$*" >&2; exit 1; }

# 1. Platform detection
OS_RAW="$(uname -s 2>/dev/null || echo unknown)"
case "$OS_RAW" in
  Linux)
    if [ -n "${TERMUX_VERSION:-}" ] || [ -d /data/data/com.termux ]; then
      PLATFORM=termux
    elif grep -qi microsoft /proc/version 2>/dev/null; then
      PLATFORM=wsl
    else
      PLATFORM=linux
    fi
    ;;
  Darwin) PLATFORM=macos ;;
  *) fail "unsupported platform: $OS_RAW" ;;
esac
log "platform: $PLATFORM"

# 2. Python
need_python_install=0
if ! command -v python3 >/dev/null 2>&1 && ! command -v python >/dev/null 2>&1; then
  need_python_install=1
fi
PY="$(command -v python3 || command -v python || true)"
if [ "$need_python_install" = "1" ] || [ -z "$PY" ] || ! "$PY" -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" 2>/dev/null; then
  log "installing Python 3.11+"
  case "$PLATFORM" in
    termux) pkg update -y && pkg install -y python ;;
    linux|wsl) sudo apt-get update && sudo apt-get install -y python3 python3-venv python3-pip ;;
    macos) brew install python@3.11 || true ;;
  esac
  PY="$(command -v python3 || command -v python || true)"
  [ -n "$PY" ] || fail "python install failed"
fi
log "python: $($PY --version)"

# 3. uv (fast installer, used by browser-use docs)
if ! command -v uv >/dev/null 2>&1; then
  log "installing uv"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
  command -v uv >/dev/null 2>&1 || fail "uv install failed"
fi
log "uv: $(uv --version)"

# 4. venv
mkdir -p "$NEXUS_BROWSER_USE_DIR"
if [ ! -d "$VENV_DIR" ]; then
  log "creating venv at $VENV_DIR"
  "$PY" -m venv "$VENV_DIR"
fi

# 5. browser-use
log "installing browser-use (this can take a few minutes on first run)"
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet "browser-use[cli]"
log "browser-use installed: $("$VENV_DIR/bin/browser-use" --version 2>&1 | head -1)"

# 6. Symlink into ~/.local/bin so 'browser-use' is on PATH
mkdir -p "$LOCAL_BIN"
ln -sf "$VENV_DIR/bin/browser-use" "$LOCAL_BIN/browser-use"
log "symlink: $LOCAL_BIN/browser-use -> $VENV_DIR/bin/browser-use"

# 7. Verify
if "$LOCAL_BIN/browser-use" --version >/dev/null 2>&1; then
  VERSION="$("$LOCAL_BIN/browser-use" --version 2>&1 | head -1)"
  log "OK: $VERSION"
else
  fail "browser-use installed but not runnable. Try: $VENV_DIR/bin/browser-use --version"
fi

cat <<EOF

Next steps
  1. Register the MCP server in ~/.config/nexus/nexus.jsonc:

$(cat <<'JSON'
  "mcp": {
    "browser-use": {
      "type": "local",
      "command": "browser-use",
      "args": ["--mcp"]
    }
  }
JSON
)

  2. Restart NEXUS and run:
     nexus-autofarm browser-use status
EOF
