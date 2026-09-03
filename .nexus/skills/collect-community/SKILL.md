---
name: collect-community
description: Offline-first ledger + contribution protocol. Records every agent/skill/MCP added on this device (by extension-hunter, auto-extend, or manually) into a local manifest, then lets the user contribute the good ones to the central NEXUS repo via PR when online. No telemetry, no secrets, public-only.
---

# collect-community — Local ledger + contribution loop

Make community discoveries flow back to NEXUS, without any live connection required for recording.

## Offline ledger (works with zero connection)
Every time an agent/skill/MCP is added on this device, append one entry to
`.nexus/community/added.json`:
```json
{
  "name": "foo-agent",
  "type": "agent|skill|mcp",
  "source": "https://github.com/... (or \"manual\")",
  "added_by": "extension-hunter|human",
  "date": "2026-08-29",
  "tags": ["imported"],
  "justification": "adds X because NEXUS lacks Y",
  "status": "local"
}
```
This file is **local and offline** — nothing leaves the device until the user contributes.

## Contribution (when a connection is available)
The user runs the `contribute` command. It:
1. Reads `.nexus/community/added.json`.
2. Bundles the listed agent/skill files onto a branch `community/<date>`.
3. Opens a PR to the central repo (`ravipacharpro-jpg/nexus-agent`) with the
   manifest + files, so the maintainer ("we") can review and merge the good ones.
4. Marks contributed entries `status: "contributed"`.

## Rules (privacy & safety)
- **Opt-in only** — nothing is sent automatically.
- **Public-only** — never record/contribute agents containing secrets or private code.
- **No telemetry** — no silent phoning home; the ledger is a plain local file.
- The maintainer still applies the auto-extend value gate before merging.
