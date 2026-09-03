#!/bin/sh
# Install an OFFLINE, no-API, no-internet LLM server so NEXUS can run with ZERO connection.
# This exposes an OpenAI-compatible endpoint locally (default http://localhost:8080/v1)
# that NEXUS's `offline/local/auto` provider talks to. No API key, no signup, fully on-device.
#
# Two engines are supported:
#   1. llama.cpp (llama-server)  -- lightweight, best for Termux/Android
#   2. Ollama                   -- easiest on Linux/macOS
#
# NOTE: you also need a GGUF model file (~1-4 GB). Pull one (e.g. Gemma 2B / Llama 3.2 1B / Qwen2.5)
# from HuggingFace, or let Ollama download it. This script does NOT download models (saves bandwidth);
# the start script will tell you the exact command.
set -e

echo "== Offline LLM server setup =="
echo "Detecting platform..."

# --- Option A: Ollama (preferred on Linux/macOS) ---
if command -v ollama >/dev/null 2>&1; then
  echo "Ollama already installed: $(command -v ollama)"
  exit 0
fi

# --- Option B: llama.cpp (preferred on Termux/Android) ---
if command -v llama-server >/dev/null 2>&1; then
  echo "llama.cpp (llama-server) already installed."
  exit 0
fi

# Termux / Android
if [ -d /data/data/com.termux ]; then
  echo "Termux detected. Try:  pkg install -y llama-cpp   (if available)"
  echo "Otherwise build from source (best on-device perf):"
  echo "  pkg install -y git cmake golang"
  echo "  git clone https://github.com/ggerganov/llama.cpp && cd llama.cpp && cmake -B build -DGGML_OPENCL=ON && cmake --build build -- -j\$(nproc)"
  echo "  # binary ends up at build/bin/llama-server"
  exit 0
fi

# Generic Linux/macOS -> install Ollama
echo "Installing Ollama (Linux/macOS)..."
if command -v curl >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
else
  echo "curl missing. Install Ollama manually: https://ollama.com/download"
fi
