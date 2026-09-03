// Vault summary reader — cross-platform (Termux / Linux / macOS / Windows).
// Reads ~/.nexus/api-vault.json and returns a structured summary so
// the TUI slash command /vault can show it without taking the autofarm
// plugin as a dependency.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export interface VaultProviderSummary {
  provider: string
  active: number
  total: number
}

export interface VaultSummary {
  totalActive: number
  totalKeys: number
  providers: VaultProviderSummary[]
  /** ISO date of last successful read (or 'never'). */
  lastRead: string
  /** Human-readable location of the vault file. */
  path: string
}

/** Read the on-disk vault and return counts grouped by provider. */
export function readVaultSummary(vaultPath?: string): VaultSummary {
  const resolved = vaultPath ?? path.join(os.homedir(), ".nexus", "api-vault.json")
  const out: VaultSummary = {
    totalActive: 0,
    totalKeys: 0,
    providers: [],
    lastRead: "never",
    path: resolved,
  }
  try {
    if (!fs.existsSync(resolved)) return out
    const raw = fs.readFileSync(resolved, "utf8")
    const j = JSON.parse(raw) as { providers?: Record<string, Array<{ status?: string }>> }
    for (const [name, list] of Object.entries(j.providers ?? {})) {
      const total = list?.length ?? 0
      const active = (list ?? []).filter((e) => e.status === "active").length
      out.providers.push({ provider: name, active, total })
      out.totalKeys += total
      out.totalActive += active
    }
    out.lastRead = new Date().toISOString()
  } catch {
    // best-effort: return what we have so the UI can still render.
  }
  return out
}

/** Render a one-line human summary for status bars / toasts. */
export function formatVaultSummary(s: VaultSummary): string {
  if (s.totalKeys === 0) return `Vault: empty (no keys at ${s.path})`
  const prov = s.providers
    .map((p) => `${p.provider}:${p.active}/${p.total}`)
    .join(" · ")
  return `Vault: ${s.totalActive} active / ${s.totalKeys} total across ${s.providers.length} provider(s) — ${prov}`
}
