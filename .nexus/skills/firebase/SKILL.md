---
name: firebase
description: Use when the user wants NEXUS to scaffold, configure, emulate, build, or deploy Firebase projects (Auth, Firestore, Functions, Hosting, Storage, Rules). Covers the safety boundary and the firebase-tools workflow.
---

# Firebase

NEXUS can drive Firebase through the `firebase` CLI (allowed via `bash`) and the
`firebase` MCP server configured in `.nexus/opencode.jsonc` (`mcp.firebase`,
which runs `npx -y firebase-tools mcp`).

## One-time authentication (user does this)

```bash
npx -y firebase-tools login
```

OAuth stores credentials in the firebase-tools secure store — never in the
NEXUS config file. No token is written to disk by NEXUS.

## Allowed autonomous work

- Generate local project configuration and SDK integration
- Emulator guidance and local dev loops
- Firestore / Storage / Security Rules **drafts** (not pushed to prod)
- Hosting build + deployment **preflight**
- Official Firebase console links

## Gated — allowed ONLY after explicit, current user confirmation

These are NOT absolute bans; they are gated. The agent must pause, show the
exact effect (preflight diff), and proceed only after the user reviews and
approves **in the current session**:

- Create billing obligations or enable paid products
- Download or retain a service-account private key (when approved, store it
  only in the user's secret store — never in repo, config, memory-sync, or logs)
- Modify production rules
- Change OAuth consent
- Deploy to production

Firebase secrets always stay in the user's existing secret-storage pathway and
are excluded from memory-sync packs and audits, regardless of confirmation.

## Workflow

1. `npx -y firebase-tools login` (user, once)
2. `firebase init` / scaffold the project
3. Develop + test on the emulator
4. Show a preflight diff for any deploy
5. Pause for explicit confirmation before production deploy or billing change

If the `firebase` MCP server fails to start, the agent can still run
`firebase` CLI commands directly through `bash` (already allowed).
