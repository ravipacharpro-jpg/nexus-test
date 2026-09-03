---
name: supabase
description: Use when the user wants NEXUS to work with Supabase — manage tables, run SQL/migrations, query data, configure auth/storage, or deploy edge functions. Covers the MCP (OAuth) and CLI workflows and the safety boundary.
---

# Supabase

NEXUS reaches Supabase through:

- **MCP (recommended)** — `mcp.supabase.com/mcp` is configured in
  `.nexus/opencode.jsonc` as a remote server. NEXUS prompts for **Supabase
  OAuth login** (human checkpoint); no token is stored in the config file.
- **CLI** — `supabase` commands run via `bash` (allowed). Authenticate once
  with `npx -y supabase login` (OAuth).

## Allowed autonomous work

- Inspect schema, tables, config, auth providers, storage buckets
- Run read queries and safe SELECTs
- Generate/migrate schema in a dev or linked project
- Manage edge functions, RLS policy drafts (not pushed to prod without confirm)

## Forbidden without explicit, current user confirmation

- Destructive SQL (DROP/TRUNCATE/DELETE on real data)
- Applying migrations to a **production** project
- Changing auth/security settings (RLS disable, provider secrets)
- Any mutation that can cause data loss or billing change

## Workflow

1. Log in via the OAuth prompt (or `supabase login` for CLI).
2. Read-only / preflight first; show the exact effect.
3. Pause for explicit confirmation before any consequential or production
   mutation.
4. Apply, then verify (re-query / dashboard check).

Secrets (service keys, JWTs) stay in Supabase's own store / the user's vault,
never written to config, memory-sync, or logs.
