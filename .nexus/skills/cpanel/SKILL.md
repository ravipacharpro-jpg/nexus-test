---
name: cpanel
description: Use when the user wants NEXUS to automate cPanel/WHM tasks (file manager, domains, databases, email, SSL, backups, DNS). Covers the browser-driven and UAPI/WHM API workflows and the safety boundary.
---

# cPanel / WHM

cPanel has no dedicated MCP server. NEXUS reaches it through capabilities already
enabled in `.nexus/opencode.jsonc`:

- **Browser UI** — the `playwright` MCP server drives the cPanel web interface.
- **UAPI / WHM API** — `curl` (allowed via `bash`) calls the cPanel/WHM REST API.

## Authentication (user-supplied, never in config)

- Browser: NEXUS navigates to the cPanel login page and **pauses at the
  human checkpoint**. The user logs in; NEXUS resumes and automates the
  post-login session only.
- API: store `CPANEL_HOST`, `CPANEL_USER`, and an API token / password in the
  NEXUS vault or shell environment. Pass them at runtime — **never** write
  credentials into `opencode.jsonc`.

  Example UAPI call pattern:
  ```bash
  curl -u "$CPANEL_USER:$CPANEL_TOKEN" \
    "https://$CPANEL_HOST:2083/execute/Domain/list_domains"
  ```

## Allowed autonomous work

- List/manage domains, subdomains, DNS zones (read + safe edits)
- File manager operations within the user's home
- Database (MySQL/PostgreSQL) create/list/backup within quota
- Email account and forwarder management
- SSL status checks, backup creation to user-owned destinations

## Forbidden without explicit, current user confirmation

Per the platform-audit module notes (cPanel is opt-in, explicit
identity/authorization, human confirmation for remote/sensitive actions):

- Account-wide or WHM-level mutations
- Deleting databases, email, or files in bulk
- DNS changes that can break mail/web
- Anything that alters billing or package limits
- Writing credentials anywhere NEXUS persists (config, memory, logs)

## Workflow

1. Confirm the target cPanel is authorized.
2. For UI tasks: open login page, pause for user login, then automate.
3. For API tasks: read-only/preflight first; show the exact effect.
4. Pause for explicit confirmation before any consequential or remote mutation.

If uncertainty exists about scope, prefer read-only checks and ask before mutating.
