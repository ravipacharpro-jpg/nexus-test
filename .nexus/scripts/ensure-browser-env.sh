#!/usr/bin/env bash
# Idempotent bootstrap for the browser MCP on Termux / Android.
# Ensures the whole chain exists: proot-distro Ubuntu, node/npm, the global
# playwright-mcp server, the Chromium browser, and (optional) xvfb + x11vnc for
# the visible/VNC mode. Safe to run any number of times; it only installs what is
# missing. The browser-mcp-launcher.mjs invokes this automatically on Android.
set -u

if ! command -v proot-distro >/dev/null 2>&1; then
  echo "[ensure] proot-distro not found. Install it first:" >&2
  echo "        pkg install proot-distro" >&2
  exit 1
fi

if ! proot-distro login ubuntu -- true >/dev/null 2>&1; then
  echo "[ensure] installing Ubuntu container (one-time, ~few hundred MB)..."
  proot-distro install ubuntu
fi

echo "[ensure] configuring browser environment inside Ubuntu..."
proot-distro login ubuntu -- bash -c '
  set -e
  command -v node >/dev/null 2>&1 || { apt-get update >/dev/null 2>&1 && apt-get install -y nodejs npm >/dev/null 2>&1; }
  command -v playwright-mcp >/dev/null 2>&1 || npm i -g @playwright/mcp
  npx playwright install chromium >/dev/null 2>&1 || true
  npx playwright install-deps chromium >/dev/null 2>&1 || true
  apt-get install -y xvfb x11vnc >/dev/null 2>&1 || true
'
echo "[ensure] browser environment ready"
