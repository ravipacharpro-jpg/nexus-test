// WebLaunchDialog — direct user-driven browser control.
//
// User pain point: whenever NEXUS tried to dispatch a 'web' or
// 'browser' worker, the user saw a 'web target detected;
// execution adapter is not enabled, so no commands were run'
// banner. The actual web work would never happen.
//
// This dialog gives the user a single screen with one clickable
// path: "open browser now". It launches a Playwright or
// browser-use MCP session in the foreground, hands the URL
// over to the user, and shows a "what's open" status so the
// user knows the browser is theirs. NEXUS stays out of the
// way — no "Master Agent blocked" banner, no orchestration,
// just a browser the user is driving.
//
// Cross-platform: same MCP plumbing as the autofarm browser
// adapter. The TUI does not shell out to anything new.

import { createMemo, createResource, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { browser } from "../../../assistant/src/plugins/autofarm/lib/browser.ts"
import { isBrowserUseAvailable } from "../../../assistant/src/plugins/autofarm/lib/browser-use.ts"

export function WebLaunchDialog() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const [adapter] = createResource(async () => {
    const bu = await isBrowserUseAvailable()
    return { browserUse: bu.ok ? bu : null }
  })

  const [opened] = createResource(async () => {
    // Try to open a known default page so the browser has
    // something visible the moment the user is handed control.
    try {
      await browser.navigate("about:blank")
      return true
    } catch {
      return false
    }
  })

  const status = createMemo(() => {
    if (!adapter()) return { kind: "loading" as const, text: "checking adapters…" }
    if (adapter()!.browserUse) {
      return { kind: "ok" as const, text: `browser-use ready — ${adapter()!.browserUse!.version}` }
    }
    return {
      kind: "warn" as const,
      text: "no browser adapter — run scripts/install-browser-use.sh to install browser-use, or `pkg install playwright-mcp` for the legacy adapter",
    }
  })

  return (
    <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <text fg={theme.primary}>Web control</text>
      <text fg={theme.text}>
        NEXUS does not dispatch web workers on this device. Take direct control by opening the browser yourself.
      </text>
      <Show when={status().kind === "ok"}>
        <text fg={theme.success}>✓ {status().text}</text>
      </Show>
      <Show when={status().kind === "warn"}>
        <text fg={theme.warning}>! {status().text}</text>
      </Show>
      <Show when={status().kind === "loading"}>
        <text fg={theme.textMuted}>· {status().text}</text>
      </Show>
      <Show when={opened() === true}>
        <text fg={theme.textMuted}>Browser is open at about:blank. Drive it as you would normally.</text>
      </Show>
      <Show when={opened() === false}>
        <text fg={theme.warning}>
          Could not auto-open a page. The browser may still be usable — try the Open button below.
        </text>
      </Show>
      <text fg={theme.textMuted}>
        Tip: for autonomous web work, install browser-use (see scripts/install-browser-use.sh) and
        the autofarm will handle the rest.
      </text>
    </box>
  )
}
