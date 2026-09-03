// Vault manager for the autofarm plugin.
// Reads & writes ~/.nexus/api-vault.json safely.
// All keys added by the farmer are tagged with source: "farm" so we never
// overwrite keys the user added by hand.

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { log } from "./logger.ts"
import type { FarmedKey, VaultKeyEntry, VaultShape } from "./types.ts"

// Resolved lazily so tests can override HOME before the first call.
function resolveVaultPath(): string {
  return path.join(os.homedir(), ".nexus", "api-vault.json")
}

function emptyVault(): VaultShape {
  return {
    providers: {},
    usage: {},
    usageBudget: { version: 1 },
    autoRotate: true,
    fallbackToLocal: true,
  }
}

export function loadVault(): VaultShape {
  try {
    const vp = resolveVaultPath()
    if (!fs.existsSync(vp)) return emptyVault()
    const raw = fs.readFileSync(vp, "utf8")
    const parsed = JSON.parse(raw) as VaultShape
    if (!parsed.providers) parsed.providers = {}
    if (!parsed.usage) parsed.usage = {}
    return parsed
  } catch (e) {
    log.warn("vault", `Failed to read vault, starting empty: ${(e as Error).message}`)
    return emptyVault()
  }
}

export function saveVault(vault: VaultShape): void {
  try {
    const vp = resolveVaultPath()
    fs.mkdirSync(path.dirname(vp), { recursive: true })
    // Atomic write to avoid corrupting the vault on crash.
    const tmp = vp + ".tmp"
    fs.writeFileSync(tmp, JSON.stringify(vault, null, 2))
    fs.renameSync(tmp, vp)
    log.debug("vault", "Vault persisted")
  } catch (e) {
    log.error("vault", `Failed to write vault: ${(e as Error).message}`)
  }
}

export function addKey(key: FarmedKey): { added: boolean; reason?: string } {
  const vault = loadVault()
  const provider = key.provider
  if (!vault.providers[provider]) vault.providers[provider] = []

  // Don't duplicate
  const exists = vault.providers[provider].some((k) => k.key === key.key)
  if (exists) return { added: false, reason: "duplicate" }

  // Per-provider cap: never exceed maxKeys
  const providerCap = vault.providers[provider].length
  if (providerCap >= 5) {
    return { added: false, reason: "provider-cap-reached" }
  }

  const entry: VaultKeyEntry = {
    key: key.key,
    label: key.label || provider,
    added: key.createdAt.slice(0, 10),
    status: key.status === "active" ? "active" : "unknown",
    failures: 0,
    source: "farm",
    lastChecked: key.validatedAt,
  }
  vault.providers[provider].push(entry)
  saveVault(vault)
  log.ok("vault", `Added ${provider} key from ${key.email.slice(0, 4)}***`)
  return { added: true }
}

export function removeBrokenKeys(): { removed: number; list: string[] } {
  const vault = loadVault()
  const removed: string[] = []
  for (const provider of Object.keys(vault.providers)) {
    const before = vault.providers[provider].length
    vault.providers[provider] = vault.providers[provider].filter((k) => {
      const keep = !(k.status === "invalid" || k.status === "expired" || (k.failures >= 5 && k.source === "farm"))
      if (!keep) removed.push(`${provider}:${k.key.slice(0, 8)}***`)
      return keep
    })
    const after = vault.providers[provider].length
    if (before !== after) log.info("vault", `Pruned ${before - after} dead key(s) from ${provider}`)
  }
  saveVault(vault)
  return { removed: removed.length, list: removed }
}

export function getAllKeys(): { provider: string; entry: VaultKeyEntry }[] {
  const vault = loadVault()
  const out: { provider: string; entry: VaultKeyEntry }[] = []
  for (const provider of Object.keys(vault.providers)) {
    for (const entry of vault.providers[provider]) out.push({ provider, entry })
  }
  return out
}

export function markKeyStatus(provider: string, key: string, status: VaultKeyEntry["status"]): void {
  const vault = loadVault()
  const list = vault.providers[provider] || []
  const found = list.find((k) => k.key === key)
  if (!found) return
  found.status = status
  found.lastChecked = new Date().toISOString()
  if (status === "invalid" || status === "expired" || status === "rate-limited") {
    found.failures = (found.failures || 0) + 1
  }
  saveVault(vault)
}

export function vaultSummary(): { providers: number; activeKeys: number; totalKeys: number } {
  const v = loadVault()
  let activeKeys = 0
  let totalKeys = 0
  for (const p of Object.keys(v.providers)) {
    for (const k of v.providers[p]) {
      totalKeys++
      if (k.status === "active") activeKeys++
    }
  }
  return { providers: Object.keys(v.providers).length, activeKeys, totalKeys }
}

export function vaultPath(): string {
  return path.join(os.homedir(), ".nexus", "api-vault.json")
}