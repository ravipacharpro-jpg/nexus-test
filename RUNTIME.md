# NEXUS Runtime — Smart Methods

Operational "tricks" that keep the agency fast, cheap, and stable at 275-agent scale.

- **On-demand agents** — agents are a catalog; only the matched agent spawns, works,
  returns its result, and frees its context. No memory leak, no accumulation.
- **Orchestrator dispatch** — task → registry tags → smallest capable agent
  (see the `economy` skill). The lead stays lean; specialists spin up only when needed.
- **Economy policy** — smallest agent + cheapest sufficient model (`auto/coding`,
  `auto/cheap`, `auto/smart`, `auto/offline`) + concurrency cap (≤3 on Termux) +
  output budget + fallback chain.
- **Registry (single source of truth)** — `.nexus/registry.json` is what the
  orchestrator reads to discover/route agents. Add/remove only via the `extend` skill.
- **Codebase-health + maintainer** — every change passes lint/typecheck/test; dead
  code is removed; nothing buggy ships.
- **Free routing (OmniRoute) — bundled** — run `/omniroute` (scripts/install-omniroute.sh +
  start-omniroute.sh) to launch the local gateway on `localhost:20128`. Model `auto` uses the
  **keyless OpenCode Free** provider (no API key, no signup). With the built-in default free
  API also on, both work without any API; OmniRoute fans out across 90+ free tiers w/ fallback + compression.
- **Offline / no-connection mode — bundled** — run `/offline` (scripts/install-offline.sh +
  start-offline.sh) to serve an on-device LLM (llama.cpp `llama-server` @ `localhost:8080/v1`
  or Ollama @ `localhost:11434/v1`). **Zero internet, zero API key.** Orchestrator fallback chain:
  internet → built-in free API / OmniRoute (free) → no internet → offline local LLM. (OGAM/PocketLLM
  are great on-device *apps* but are not OpenAI-compatible servers NEXUS calls; use llama.cpp/Ollama.)
- **Self-improvement** — learn from runs, propose upgrades through `extend`
  (controlled, reviewed — never blind mutation).
- **Amplification** — a weak/cheap base model still delivers high-tier work: fine
  decomposition + rich specs + tool-offload + mandatory verify-fix loop (see `amplify`
  skill). The agency, not the model, carries the intelligence.
- **Auto-extend (extension-hunter)** — an autonomous GitHub scout finds public, powerful agents/skills/MCP and integrates them via `auto-extend` (no login, validated, deduped). The agency levels itself up from the open-source community.
- **Community loop (collect-community + /contribute)** — every agent added on a user's device is recorded in a local offline ledger (`.nexus/community/added.json`); the user later contributes the good ones to the central NEXUS repo via PR. No telemetry, public-only, opt-in. Best community agents reach "us" for curation.
- **Human checkpoints** — login / OTP / CAPTCHA / payment stay manual, always.

Apply these and the system scales to hundreds of agents without slowing down or
bloating cost.

## Cross-platform support & release policy

NEXUS agents/skills/configs are plain text and run wherever NEXUS runs:
**Termux (Android), Linux, macOS, and Windows** (Windows uses WSL or Git Bash for the
POSIX helper scripts in `scripts/`).

- Agents, skills, commands, `registry.json`, `opencode.jsonc` → platform-agnostic.
- `scripts/install-omniroute.sh`, `start-omniroute.sh`, `install-offline.sh`,
  `start-offline.sh` → POSIX `sh`; native on Linux/macOS/Termux, WSL/Git Bash on Windows.
- CI runs `scripts/validate.js` on **ubuntu / windows / macos** on every push, so a
  broken change is caught before release.

**Release policy:** every feature is committed → pushed to `main` → tagged as a GitHub
release, so all platforms receive it. No feature ships to one OS only.
