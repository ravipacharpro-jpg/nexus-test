---
name: extend
description: The method to add ANY new capability to NEXUS — agent, skill, MCP server, or command — in a managed, validated, registered, and documented way so the system scales without becoming a mess. Use this whenever you or the user want to add something new.
---

# extend — Add Any Capability, Managed

This is the single method for growing NEXUS. Follow it for every addition so nothing
becomes orphaned, duplicated, undocumented, or broken.

## Steps
1. **Classify** — one of: `agent` | `skill` | `mcp` | `command`.
2. **Place** in the correct directory:
   - agent  → `.nexus/agent/<slug>.md`  (frontmatter: name, description, mode, color; body = role/persona)
   - skill  → `.nexus/skills/<slug>/SKILL.md`  (frontmatter: name, description)
   - command→ `.nexus/command/<slug>.md`
   - mcp    → add entry under `mcp` in `opencode.jsonc` (local: `command`+`args`; remote: `type:"remote"`+`url`)
3. **Register** — add ONE entry to `.nexus/registry.json` (name, purpose, tags). This is
   the single source of truth the orchestrator reads. No registry entry = invisible to routing.
4. **Tag** — 1–3 lowercase tags (e.g. `frontend`, `test`, `deploy`) so the orchestrator can route.
5. **Validate** — run `codebase-health`: frontmatter present, no broken refs, lint clean.
6. **Wire** — if it changes a flow, update `sop` and the `orchestrator` routing map.
7. **Document** — one line in `NEXUS_SETUP.md` capabilities list.

## Rules (ponytail/maintainer discipline)
- Check `registry.json` FIRST — never add a duplicate; extend the existing one instead.
- Never leave an entry unregistered (orphaned capabilities rot).
- Keep it lean: if it overlaps an existing capability, reuse/extend that one.
- After adding, the `maintainer` confirms the system is still green.

## Result
Anything added this way is: **discoverable** by the orchestrator, **validated**,
**documented**, and **kept clean** by `codebase-health` + `maintainer`. The system
grows on demand and stays professional, stable, and bug-free.
