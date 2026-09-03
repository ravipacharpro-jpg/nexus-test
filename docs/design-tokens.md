# NEXUS Design Tokens (Reference Spec)

This file is the single source of truth for cross-agent design
conventions. Code-generating and UI-generating agents are expected
to read this file before producing output, and to validate their
output against it where automatable.

UI and styling decisions live here so that 5 different agents
that emit HTML / JSX / Lua / config snippets do not end up with
5 different button colors, 5 different log formats, or 5
different "loading…" strings.

---

## 1. Color tokens

| Token            | Hex      | Use                                          |
| ---------------- | -------- | -------------------------------------------- |
| `--text`         | `#E4E4E7`| Default foreground text                      |
| `--text-muted`   | `#71717A`| Secondary text, status notes, timestamps     |
| `--primary`      | `#7C3AED`| Brand color, focus highlight, accent button  |
| `--success`      | `#22C55E`| OK checks, healthy status indicators         |
| `--warning`      | `#F59E0B`| Degraded but not failed, partial coverage    |
| `--error`        | `#EF4444`| Hard failures, blocked, user-blocking errors |
| `--info`         | `#3B82F6`| Informational banners, never a status code   |
| `--background`   | `#0A0A0A`| Terminal / dark-mode default                 |
| `--background-2` | `#18181B`| Elevated panels, cards, dialogs               |

Status-glyph convention (every agent that prints a row uses these):

| Status  | Glyph | ANSI color   |
| ------- | ----- | ------------ |
| `ok`    | `✓`   | green        |
| `warn`  | `!`   | yellow       |
| `fail`  | `x`   | red          |
| `info`  | `·`   | grey         |

## 2. Log format

Every NEXUS log line is `LEVEL  module: message`. Example:

```
INFO  autofarm: gmail-farm start: 5 gmail(s) x 13 provider(s)
WARN  gmail:     captcha required for nfarm81c4@gmail.com
ERROR browser:   playwright-mcp not installed
```

- Levels: `DEBUG`, `INFO`, `WARN`, `ERROR` (uppercase, fixed width 5)
- Module: short identifier, lowercase, fixed width 12
- Message: free-form, ends with a period

## 3. Command / slash-name convention

- One verb per command: `nexus-autofarm health`, not `nexus-autofarm show-health`.
- Slash names match CLI subcommands 1:1: `/health` ↔ `nexus-autofarm health`.
- Aliases go in `slashAliases`, not in `slashName`.
- Hidden commands (`hidden: true`) are reserved for keybindings and are never user-visible.

## 4. File-output contract (for ToolAgent, BotAgent, all generators)

| Field            | Required | Notes                                            |
| ---------------- | -------- | ------------------------------------------------ |
| `outputDir`      | yes      | absolute path the caller can `cd` into           |
| `name`           | yes      | kebab-case slug, ≤ 48 chars                      |
| `files`          | yes      | relative file names inside `outputDir`           |
| `ok`             | yes      | `true` only when every verification receipt is 0  |
| `receipts`       | yes      | at least one entry per side-effect (write/shell)  |
| `limitations`    | yes      | honest list of what this version cannot do        |

If `ok === false`, the caller MUST show the user the first failing
receipt's `command` + `exitCode`. Silent fake success is forbidden.

## 5. Lua / config / JSON conventions

- 2-space indent, LF line endings, UTF-8 no BOM.
- Never commit `console.log` or `print(...)` debug statements.
- Never commit `TODO` / `FIXME` without a date and an owner.
- `package.json` is the single source of truth for runtime deps;
  `bun.lock` is auto-generated.

## 6. Error-message convention

For any error the user might see, the message must contain:
- WHAT failed (one short clause)
- WHY it likely failed (one short clause)
- WHAT to try next (Ctrl+P hint, env-var name, or document link)

The `humanizeError` helper in `packages/tui/src/util/error.ts`
enforces this for 9 common error classes. New error classes
should grow that list, not bypass it.

## 7. How an agent should consume this file

Pseudocode for the next agent that generates any UI / config / Lua:

```ts
const tokens = await readFile("docs/design-tokens.md", "utf8")
if (!tokens.includes("--primary")) {
  throw new Error("design-tokens.md missing --primary — refusing to emit ad-hoc colors")
}
const out = myGenerator()
if (out.includes("#FF0000")) {
  throw new Error("refusing to emit hardcoded red; use var(--error) from design-tokens")
}
```
