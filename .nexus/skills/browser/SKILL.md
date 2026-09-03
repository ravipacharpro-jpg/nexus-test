---
name: browser
description: Give the agent a controllable web browser for autonomous browsing, clicking, form-filling, and human-in-the-loop login on Termux/Android, with minimal user effort. The browser runs headless inside a proot-distro Ubuntu container (process.platform === "linux", so Playwright works) — no display server or VNC app needed. The agent browses fully autonomously; when a site needs login/captcha, it opens the URL in the user's REAL phone browser (via termux-open) so the user taps login there, then the agent continues via token/API. Use when the user wants the agent to navigate websites, automate web UIs, or interact with pages that have no API. On desktop/Linux/macOS the same tools come from a plain `npx -y @playwright/mcp`.
slash: true
---

# Browser Automation (Termux / Android — low-effort, autonomous)

Goal: the agent drives a real Chromium — opens pages, clicks, types, reads the DOM / takes screenshots, and completes logins with the user's help, **without the user installing anything extra** (no VNC app).

## Why proot Ubuntu + headless

Playwright hard-blocks `process.platform === "android"`, so its Chromium cannot run directly on Termux. Inside a `proot-distro` Ubuntu container the platform is `linux`, so Playwright + Chromium run fine. NEXUS stays on Termux; it spawns the Playwright MCP server **inside** Ubuntu via `.nexus/scripts/browser-mcp-launcher.mjs`, a portable launcher that auto-detects the OS: on Android/Termux it runs the server inside the Ubuntu proot, on Windows/macOS/Linux it runs `npx -y @playwright/mcp` directly. So **the same config works on every platform** (see `.nexus/opencode.jsonc` → `mcp.playwright`). The browser runs **headless** by default, so there is no display/VNC requirement and the agent is autonomous for everything except human-only steps (captcha/OAuth).

## Setup (already done by the agent)

- `proot-distro` Ubuntu installed; `node` + `npm` present.
- Inside Ubuntu: `npm i -g @playwright/mcp`, `playwright install chromium`, apt deps installed.
- **This NEXUS build reads MCP servers from `~/.config/nexus/nexus.jsonc` (via `nexus mcp add`), NOT from `.nexus/opencode.jsonc`.** The playwright server is already added there. To (re)configure it reproducibly from this repo, run:
  - `bash .nexus/scripts/setup-browser-mcp.sh`
  This runs `nexus mcp add playwright -- node .nexus/scripts/browser-mcp-launcher.mjs --browser chromium --no-sandbox --headless --mobile --warmup`.
- `.nexus/opencode.jsonc` also carries the `playwright` entry for source builds; it is ignored by the installed binary.
- Self-healing: `.nexus/scripts/browser-mcp-launcher.mjs` runs `.nexus/scripts/ensure-browser-env.sh` automatically on Android at startup. If the Ubuntu container or Chromium is ever missing/wiped, the launcher reinstalls it idempotently — no manual `proot-distro` steps needed. Run the script by hand only to force a rebuild: `bash .nexus/scripts/ensure-browser-env.sh`.

## Usage

Tools exposed: `browser_navigate`, `browser_click`, `browser_type`, `browser_fill_form`, `browser_snapshot`, `browser_take_screenshot`, `browser_tabs`, `browser_handle_dialog`, `browser_wait_for`, `browser_evaluate`, etc.

1. **Autonomous browsing (no user action):** `browser_navigate` → `browser_snapshot`/`browser_take_screenshot` → `browser_click`/`browser_type`. Fully headless; the user does nothing.
2. **Login / captcha (automatic hybrid handoff — zero agent guesswork):**
    - The launcher **auto-detects** login/OAuth/captcha URLs (patterns like `/login`, `/oauth`, `captcha`, `sso`, `account`, `consent`, `callback`) whenever the agent calls `browser_navigate`, and **opens that exact URL in the user's real phone/desktop browser** on the host via `termux-open` (Android) or `xdg-open`/`open` (desktop). A log line is printed so the user knows. The headless Chromium still navigates too, so the agent can inspect the page.
    - The user taps "Sign in" / "Continue with Google" / solves captcha in their normal phone browser.
    - The agent continues via **token / API**, not by reading the phone browser's session:
      - **GitHub:** the `gh` CLI is already authenticated — use `gh api ...` / `gh auth status`. No browser login needed for GitHub at all.
      - **Other sites:** ask the user to generate a personal access token / session cookie and paste it; the agent then uses it via `curl` / `webfetch` / API calls.
    - If a login link is found only inside page text (not via `browser_navigate`), the agent can call `.nexus/scripts/phone-open.sh "<url>"` directly.
    - Do NOT attempt to bypass captcha/OAuth or phish credentials.

## Rules

- Never try to defeat captcha, solve OAuth challenges, or phish credentials. Hand those to the user via their real browser.
- Prefer APIs/CLIs (`gh`, REST) over UI clicking when an API exists; use the browser only when none does.
- Keep DOM dumps small; prefer `browser_snapshot` and reference screenshot files.

## Optional: see the browser (VNC)

If the user wants to *watch* the Chromium (e.g. to click a captcha inside the agent's own browser instead of the hybrid), run `.nexus/scripts/start-browser-env.sh` (starts Xvfb + x11vnc) and connect a VNC viewer to `127.0.0.1:5900`. For that mode, change the MCP command to drop `--headless` and set `DISPLAY=:0` (see the script's comments). Default mode needs no VNC.

## Variants

- **Desktop / Linux / macOS:** the launcher auto-detects and runs `npx -y @playwright/mcp` directly — nothing to change in the config. It just needs `node`/`npx` available (standard on those platforms) and will auto-install the server on first run. The Android bootstrap (Ubuntu + Chromium) is only required on Android/Termux devices.
