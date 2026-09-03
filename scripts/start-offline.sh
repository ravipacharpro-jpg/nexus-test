#!/bin/sh
# Platform: Linux / macOS / Termux (Android) native; Windows -> use WSL or Git Bash (POSIX sh).
# Start the OFFLINE local LLM server (no API, no internet) on http://localhost:8080/v1
# NEXUS's `offline/local/auto` provider points here. Keep it running to use NEXUS fully offline.
set -e

ENGINE="${OFFLINE_ENGINE:-llama.cpp}"
MODEL="${OFFLINE_MODEL:-}"
PORT="${OFFLINE_PORT:-8080}"

# --- Ollama mode ---
if [ "$ENGINE" = "ollama" ]; then
  if ! command -v ollama >/dev/null 2>&1; then
    echo "Ollama not installed. Run: bash scripts/install-offline.sh"; exit 1
  fi
  echo "Starting Ollama..."
  nohup ollama serve >${TMPDIR:-/tmp}/offline-llm.log 2>&1 &
  OLLAMA_PID=$!
  sleep 3
  if [ -z "$MODEL" ]; then MODEL="gemma2:2b"; fi
  echo "Pulling model $MODEL (one-time download)..."
  ollama pull "$MODEL" || true
  echo "OK — Ollama up. NEXUS offline provider -> http://localhost:11434/v1 (model $MODEL)"
  echo "NOTE: set OFFLINE_PORT=11434 and api http://localhost:11434/v1 in config/offline-provider.jsonc for Ollama."
  exit 0
fi

# --- llama.cpp mode (default) ---
if ! command -v llama-server >/dev/null 2>&1; then
  echo "llama-server not found. Run: bash scripts/install-offline.sh"; exit 1
fi
if [ -z "$MODEL" ]; then
  echo "Set OFFLINE_MODEL to a local .gguf path, e.g.:"
  echo "  OFFLINE_MODEL=/sdcard/models/gemma-2b-it-q4_k_m.gguf bash scripts/start-offline.sh"
  exit 1
fi
echo "Starting llama.cpp server on http://localhost:$PORT/v1 (model $MODEL)..."
nohup llama-server -m "$MODEL" --port "$PORT" --host 127.0.0.1 >${TMPDIR:-/tmp}/offline-llm.log 2>&1 &
OM_PID=$!
sleep 3
if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/v1/models" 2>/dev/null | grep -q 200; then
  echo "OK — offline LLM up (pid $OM_PID). NEXUS provider offline/local/auto now serves on-device, no API, no internet."
else
  echo "Server may still be loading. Check ${TMPDIR:-/tmp}/offline-llm.log (pid $OM_PID)."
fi
