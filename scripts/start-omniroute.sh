#!/bin/sh
# Platform: Linux / macOS / Termux (Android) native; Windows -> use WSL or Git Bash (POSIX sh).
# Start the OmniRoute local gateway on http://localhost:20128/v1
# Keyless NEXUS Free Gateway is pre-wired into model 'auto' → $0, no API key.
# Backgrounds the server and prints a health check. Keep it running while using NEXUS.
set -e
if ! command -v omniroute >/dev/null 2>&1; then
  echo "OmniRoute not installed. Run: bash scripts/install-omniroute.sh"
  exit 1
fi
echo "Starting OmniRoute gateway on http://localhost:20128/v1 (keyless NEXUS Free Gateway)..."
nohup omniroute >${TMPDIR:-/tmp}/omniroute.log 2>&1 &
OM_PID=$!
sleep 3
if curl -s -o /dev/null -w "%{http_code}" http://localhost:20128/v1/models 2>/dev/null | grep -q 200; then
  echo "OK — gateway up (pid $OM_PID). NEXUS provider omniroute/auto now serves NEXUS free models, no API key."
else
  echo "Gateway may still be booting. Check ${TMPDIR:-/tmp}/omniroute.log (pid $OM_PID)."
fi
