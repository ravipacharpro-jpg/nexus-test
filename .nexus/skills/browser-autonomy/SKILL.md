---
name: browser-autonomy
description: Universal browser autonomy for ANY web app or service. Use whenever the user wants NEXUS to drive a website — GitHub, Firebase, cPanel, Render, Vercel, AWS, banking, dashboards, or any arbitrary site. Covers the open → human-checkpoint → automate loop.
---

# Browser Autonomy (universal, any web app)

The `playwright` MCP server configured in `.nexus/opencode.jsonc`
(`mcp.playwright`) is **generic**: it drives ANY website, not just the
pre-wired services. Structured MCPs (github, firebase) are optional shortcuts on
top of this universal layer.

## The loop

1. **Locate** the right page from the user's task (official URL, or ask if unsure).
2. **Open** it with the browser tool — the agent does this itself.
3. **Human checkpoint** — pause at login, password, OTP, authenticator,
   CAPTCHA, payment, or any personal/regulated step. The user completes it in
   their own browser/session; the agent never sees or stores those credentials.
4. **Automate** the rest of the task within the authenticated session.
5. **Verify** with a screenshot / page read / API check, then report.

## Hard boundaries (apply to EVERY site)

- Never automate login / password / OTP / CAPTCHA / payment.
- Never read or store cookies, session tokens, or form credentials.
- Never take consequential or destructive action without a fresh, in-session
  user confirmation (show the exact effect first).
- Secrets go to the user's vault/secret-store, never into config, memory-sync,
  or logs.

## Examples

- "Merge my PR and deploy" → open GitHub PR, pause for login, then click merge +
  open the hosting dashboard, pause for deploy confirm, deploy.
- "Check my Render logs" → open Render, pause for login, read logs, summarize.
- "Update DNS on cPanel" → open cPanel, pause for login, show the DNS diff,
  wait for explicit confirm, apply.

## Setup

- Requires Node.js + `npx` (Playwright MCP auto-downloads Chromium).
- Run NEXUS from this repo so it reads `.nexus/opencode.jsonc`.
- Mirror `mcp` + `permission` into `~/.config/nexus/opencode.jsonc` for
  update-safety.

The agent may open multiple sites in one task; it re-enters the human
checkpoint on every site that requires authentication.
