# NEXUS Agent — System Setup

This is a hardened, autonomous NEXUS agent configuration for
`ravipacharpro-jpg/nexus-agent`. It combines the upstream autonomy fork with a
professional "agency" of specialist subagents, MCP tool servers, and skills.

## What's included

### MCP servers (in `.nexus/opencode.jsonc` → `mcp`)
- `playwright` — real browser automation (Chromium), screenshots, console checks.
- `github` — repos, issues, PRs, releases via `gh`/GitHub MCP.
- `firebase` — Firebase/Hosting/Auth admin.
- `supabase` — Supabase projects, migrations, edge functions.
- `cpanel` — cPanel/Hostinger UAPI/SSH hosting ops.

### Free AI Gateway — OmniRoute (bundled, keyless)
Run `/omniroute` (scripts/install-omniroute.sh + start-omniroute.sh) to launch a local
gateway on `http://localhost:20128/v1`. Model `auto` uses the **keyless "OpenCode Free"**
provider — free models with NO API key and NO signup. Combined with the built-in default
free API, both providers work without any API. OmniRoute also fans out across 90+ free tiers
with auto-fallback + token compression, and is wired as the NEXUS `provider` (`model:
omniroute/auto`). Keep the gateway running while using NEXUS.

### Skills (`.nexus/skills/`)
`browser-autonomy`, `deploy`, `firebase`, `supabase`, `cpanel`, `memory`,
`notify`, `ponytail`, `codebase-health`, `sop`, `economy`, `self-improvement`,
`amplify`, `auto-extend`, `collect-community`.

### Specialist subagents (`.nexus/agent/`)
Curated from `msitarzewski/agency-agents` (OpenCode format, `mode: subagent`):
engineering (frontend/backend/architect/senior/rapid/mobile/i18n/devops/sre/
autonomous-optimization/minimal-change), design (ui/ux/finish-gate), testing
(automation/api/accessibility/performance/reality-checker/results), plus the
`orchestrator` planner and `maintainer` guardian.

### How it stays coordinated
- **Orchestrator** plans + assigns specialists.
- **SOP** is the mandatory delivery playbook (intake → plan → build → verify → notify).
- **Maintainer + codebase-health** enforce lint/typecheck/test gates and remove
  dead code — stability and no bugs.
- **notify** pings the user at checkpoints; **memory** recalls preferences.

## Human checkpoints (never automated)
Login, OTP, CAPTCHA, payment, explicit approvals. Everything else is autonomous.

## Update safety
Repo-bundled `.nexus/opencode.jsonc` can be overwritten by a NEXUS update. To
stay safe, also place the same `mcp` + `permission` block in your **user-level**
config at `~/.config/nexus/opencode.jsonc` (see `config/user-opencode.example.jsonc`).

## Capability management (the `extend` method)
Add ANY new capability — agent, skill, MCP, command — via the **`extend`** skill. It
registers the addition in `.nexus/registry.json` (the orchestrator's single source of
truth) and validates it with `codebase-health`. This keeps the system managed,
documented, and free of duplicates/orphans as it grows on demand.

## Global config (update-safe + applies to all projects)
The same `provider` + `mcp` + `permission` block is also written at the **user level**
`~/.config/nexus/opencode.jsonc`, so every NEXUS project on this machine inherits the
free OmniRoute routing and the MCP tools — and a NEXUS update cannot wipe it.

## Secrets
See `SECRETS.md` — credentials are never stored in config.
