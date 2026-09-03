// DialogVault — shows the on-disk vault summary (active / total keys
// per provider). Triggered by the /vault slash command from the prompt.
// Cross-platform: works on Termux, Linux, macOS, Windows. No autofarm
// plugin dependency, no MCP, no internet.

import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { formatVaultSummary, readVaultSummary } from "../util/vault-summary"

export function DialogVault() {
  const { theme } = useTheme()
  const summary = createMemo(() => readVaultSummary())

  return (
    <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <text fg={theme.primary}>API vault</text>
      <text fg={theme.textMuted}>{summary().path}</text>
      <Show
        when={summary().totalKeys > 0}
        fallback={
          <text fg={theme.text}>
            No keys found. Add one via Ctrl+P → Provider, or run: nexus-autofarm add-keys 1 openrouter
          </text>
        }
      >
        <text fg={theme.text}>{formatVaultSummary(summary())}</text>
        <box flexDirection="column" gap={0} marginTop={1}>
          <For each={summary().providers}>
            {(p) => (
              <text fg={theme.text}>
                · {p.provider.padEnd(14)} {p.active}/{p.total} active
              </text>
            )}
          </For>
        </box>
      </Show>
      <text fg={theme.textMuted}>Last read: {summary().lastRead}</text>
    </box>
  )
}
