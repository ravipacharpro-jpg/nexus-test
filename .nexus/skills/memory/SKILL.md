---
name: memory
description: Remember user preferences, common project URLs, tech stack, and recurring context across sessions so the agent asks fewer questions and acts more autonomously. Reads at session start, updates when new preferences are learned.
---

# Memory

The agent should persist lightweight, non-secret context so repeated tasks need
no re-explaining. Secrets NEVER go here — only in the vault.

## Store location

- User-level: `~/.local/share/nexus/memory/USER.md`
- Project-level: `.nexus/memory/USER.md` (commit if shared with a team)

Create it if missing. Read it at the start of every session.

## Structure

```markdown
# User Memory

## Identity
- Name / handles
- Primary GitHub: <user>

## Projects
- <project>: <what it is, repo URL, stack>

## Common URLs
- Dashboard: <url>
- Staging: <url>

## Preferences
- Language for replies: Hinglish
- Hosting default: Render
- Confirm before prod deploy: yes

## Style
- Concise responses
- Prefer CLI over dashboards
```

## Rules

- Update the file when the user states a new preference or project fact.
- Never record passwords, tokens, OTPs, cookies, or payment data.
- If a remembered fact is uncertain, ask once, then update.
- Keep it small; prune stale entries.
