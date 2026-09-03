// StatusBar — bottom-of-screen, always-visible health summary.
// Shows the most useful at-a-glance numbers so the user never has to
// open a dialog to know whether the system is healthy.
//
//   ◴ 2m 14s  •  ↻ 5 keys  •  ▾ 147.6k in / 313k out  •  ⚡ claude-3.5
//
// Defaults: read ~/.nexus/api-usage.json and ~/.nexus/api-vault.json
// directly so the bar works even when no provider is connected.

import { createMemo, createResource, onCleanup, Show } from "solid-js"
import { existsSync, readFileSync, statSync } from "node:fs"
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import os from "node:os"
import { useTheme } from "../context/theme"

export function StatusBar() {
  const { theme } = useTheme()

  // Refresh the underlying JSON files every 5s so the bar stays live.
  const [usage] = createResource(async () => {
    const path = join(os.homedir(), ".nexus", "api-usage.json")
    if (!existsSync(path)) return { totalIn: 0, totalOut: 0, requests: 0 }
    try {
      const j = JSON.parse(readFileSync(path, "utf8")) as Record<
        string,
        { todayInputTokens?: number; todayOutputTokens?: number; todayRequests?: number }
      >
      let totalIn = 0,
        totalOut = 0,
        requests = 0
      for (const v of Object.values(j)) {
        totalIn += v.todayInputTokens ?? 0
        totalOut += v.todayOutputTokens ?? 0
        requests += v.todayRequests ?? 0
      }
      return { totalIn, totalOut, requests }
    } catch {
      return { totalIn: 0, totalOut: 0, requests: 0 }
    }
  })

  const [vault] = createResource(async () => {
    const path = join(os.homedir(), ".nexus", "api-vault.json")
    if (!existsSync(path)) return { active: 0, total: 0 }
    try {
      const j = JSON.parse(readFileSync(path, "utf8")) as {
        providers?: Record<string, Array<{ status?: string }>>
      }
      let active = 0,
        total = 0
      for (const list of Object.values(j.providers ?? {})) {
        for (const entry of list ?? []) {
          total++
          if (entry.status === "active") active++
        }
      }
      return { active, total }
    } catch {
      return { active: 0, total: 0 }
    }
  })

  // Session uptime — refreshed every second.
  const [tick, setTick] = createResource(() => {
    return new Promise<number>((resolve) => {
      const start = Date.now()
      const i = setInterval(() => setTick.refetch(), 1000)
      onCleanup(() => clearInterval(i))
      // The actual value is `Date.now() - start`; setTick.refetch()
      // re-runs this fetcher so we can just return the current delta.
      resolve(Date.now() - start)
    })
  })

  // re-tick usage & vault every 5s
  setInterval(() => {
    usage.refetch()
    vault.refetch()
  }, 5_000)
  onCleanup(() => clearInterval)

  const tokensIn = createMemo(() => usage()?.totalIn ?? 0)
  const tokensOut = createMemo(() => usage()?.totalOut ?? 0)
  const requests = createMemo(() => usage()?.requests ?? 0)
  const activeKeys = createMemo(() => vault()?.active ?? 0)
  const totalKeys = createMemo(() => vault()?.total ?? 0)
  const uptimeMs = createMemo(() => tick() ?? 0)

  const fmtDuration = (ms: number) => {
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ${s % 60}s`
    const h = Math.floor(m / 60)
    return `${h}h ${m % 60}m`
  }

  const fmtTokens = (n: number) => {
    if (n < 1000) return `${n}`
    if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
    return `${(n / 1_000_000).toFixed(2)}M`
  }

  return (
    <box flexDirection="row" gap={2} flexShrink={0}>
      <text fg={theme.textMuted}>◴ {fmtDuration(uptimeMs())}</text>
      <text fg={theme.textMuted}>·</text>
      <text fg={theme.textMuted}>↻ {activeKeys()}/{totalKeys()} keys</text>
      <Show when={tokensIn() + tokensOut() > 0}>
        <text fg={theme.textMuted}>·</text>
        <text fg={theme.textMuted}>
          ▾ {fmtTokens(tokensIn())} in / {fmtTokens(tokensOut())} out ({requests()} req)
        </text>
      </Show>
    </box>
  )
}
