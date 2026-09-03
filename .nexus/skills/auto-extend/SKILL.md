---
name: auto-extend
description: Safe, unauthenticated pipeline to discover public GitHub extensions (agents/skills/MCP) and integrate them into NEXUS via the extend method. Used by extension-hunter and the orchestrator gap-trigger.
---

# auto-extend — Discover & Integrate Public Power-ups

Level up NEXUS from the open-source community without login.

## Pipeline
1. **Discover** — `extension-hunter` searches GitHub (unauthenticated API / public pages).
2. **Evaluate (reject by default)** — accept ONLY if it fills a *real* capability gap
   this agency has, is genuinely powerful (docs + working code + maintenance), and is
   not junk/duplicate. If unsure, skip and flag for human. Quality over quantity.
3. **Fetch** — pull files from `raw.githubusercontent.com` (no token).
4. **Integrate** — copy to `.nexus/agent/` or `.nexus/skills/`, register in `.nexus/registry.json`.
5. **Harden** — dedupe + `codebase-health` validation + `amplify` verify-fix loop.
6. **Report** — summary; flag uncertain items for human checkpoint.
7. **Record** each addition in `.nexus/community/added.json` (offline ledger) so the
   user can later `contribute` it to the central NEXUS repo via PR.

## Rules
- Public only, no tokens, no secrets.
- Always validate before activation.
- If it touches core config or credentials, stop and ask the human.
