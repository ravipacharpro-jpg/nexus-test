---
name: offline
description: Run NEXUS fully offline (no internet, no API key) by pointing the provider at a local on-device LLM server (llama.cpp / Ollama)
---
# /offline — true no-connection mode

Make NEXUS work with **zero internet and zero API key** using an on-device model.

## What actually serves NEXUS offline
NEXUS needs an **OpenAI-compatible HTTP endpoint** it can call locally. The right
engines (both expose `/v1`, no key) are:

- **llama.cpp** (`llama-server`, port 8080) — lightest, best for Termux/Android.
- **Ollama** (port 11434) — easiest on Linux/macOS.

> Note: OGAM (off-grid-ai/OGAM) and PocketLLM are great *on-device apps*, but they are
> not OpenAI-compatible servers NEXUS can call. Use them as companion apps; for NEXUS's
> offline provider use llama.cpp/Ollama below.

## Steps
1. Install an engine: `bash scripts/install-offline.sh`
2. Start it with a local GGUF model:
   - llama.cpp: `OFFLINE_MODEL=/path/to/model.gguf bash scripts/start-offline.sh`
   - Ollama: `OFFLINE_ENGINE=ollama OFFLINE_MODEL=gemma2:2b bash scripts/start-offline.sh`
3. Point NEXUS at it: copy `config/offline-provider.jsonc` into your
   `~/.config/nexus/` (or merge its `provider.offline` block). For Ollama set
   `api: "http://localhost:11434/v1"`.
4. Set `model: "offline/local/auto"` (or just rely on orchestrator fallback).

Once running, the orchestrator's fallback chain is:
**internet → built-in free API / OmniRoute (free) → no internet → offline local LLM**.
NEXUS then operates with no API and no connection at all.

You still need a GGUF model file (~1–4 GB) from HuggingFace for llama.cpp, or let
Ollama pull one. A capable device (≥4 GB RAM free) is recommended.
