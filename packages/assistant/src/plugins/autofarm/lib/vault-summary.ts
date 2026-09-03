// vault-summary.ts — public surface for `/vault` slash command and
// the StatusBar key counter. Wraps vault.vaultSummary() + adds a
// human-readable breakdown that the TUI dialog can render directly.
//
// Usage:
//   import { getVaultSummary } from "./vault-summary.ts"
//   const summary = getVaultSummary()   // synchronous, reads ~/.nexus/api-vault.json
//   const text   = formatVaultSummary(summary)

import { loadVault, vaultSummary, vaultPath } from "./vault.ts"
import type { VaultKeyEntry } from "./types.ts"

export interface VaultProviderBreakdown {
  provider: string
  total: number
  active: number
  invalid: number
  rateLimited: number
  expired: number
  unknown: number
}

export interface VaultSummary {
  /** Where the vault file lives (for diagnostics). */
  path: string
  providers: number
  activeKeys: number
  totalKeys: number
  /** Per-provider counts. */
  breakdown: VaultProviderBreakdown[]
  /** Whether the vault file exists. */
  exists: boolean
}

/** Read the vault synchronously and return counts. Safe to call from
 *  a SolidJS createMemo on every render — no I/O beyond one fs read. */
export function getVaultSummary(): VaultSummary {
  const path = vaultPath()
  const full = loadVault()
  const base = vaultSummary()
  const breakdown: VaultProviderBreakdown[] = Object.entries(
    full.providers ?? {},
  ).map(([provider, entries]) => {
    const list: VaultKeyEntry[] = Array.isArray(entries) ? entries : []
    const counts = { active: 0, invalid: 0, "rate-limited": 0, expired: 0, unknown: 0 }
    for (const e of list) {
      const k = e.status ?? "unknown"
      if (k in counts) counts[k as keyof typeof counts]++
    }
    return {
      provider,
      total: list.length,
      ...counts,
    }
  })
  breakdown.sort((a, b) => b.active - a.active || a.provider.localeCompare(b.provider))
  return {
    path,
    providers: base.providers,
    activeKeys: base.activeKeys,
    totalKeys: base.totalKeys,
    breakdown,
    exists: true,
  }
}

/** Render a VaultSummary as a multi-line plain-text block, suitable
 *  for the TUI dialog body and the `/vault` slash command output. */
export function formatVaultSummary(s: VaultSummary): string {
  const lines: string[] = []
  lines.push(`Vault: ${s.path}`)
  lines.push(
    `Providers: ${s.providers}  •  Active keys: ${s.activeKeys}  •  Total keys: ${s.totalKeys}`,
  )
  if (s.breakdown.length === 0) {
    lines.push("(no providers yet — add keys with /keys add <provider> <apiKey>)")
  } else {
    lines.push("")
    for (const b of s.breakdown) {
      const flagged = b.invalid + b.rateLimited + b.expired
      const flagStr = flagged > 0 ? `  (${flagged} flagged)` : ""
      lines.push(
        `  ${b.provider.padEnd(14)} ${String(b.active).padStart(3)} active / ${b.total} total${flagStr}`,
      )
    }
  }
  return lines.join("\n")
}
