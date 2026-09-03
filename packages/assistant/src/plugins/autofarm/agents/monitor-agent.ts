// Monitor agent: keeps an eye on api-usage.json + the vault, and
// detects when keys are about to run out so the orchestrator can farm.

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { log } from "../lib/logger.ts"
import { loadVault, saveVault } from "../lib/vault.ts"
import type { SupplySignal, SystemLoad } from "../lib/types.ts"

function usagePath(): string {
  return path.join(os.homedir(), ".nexus", "api-usage.json")
}

interface UsageShape {
  [provider: string]: {
    todayRequests: number
    todayInputTokens: number
    todayOutputTokens: number
    lastUsed?: string
  }
}

function readUsage(): UsageShape {
  try {
    const up = usagePath()
    if (!fs.existsSync(up)) return {}
    return JSON.parse(fs.readFileSync(up, "utf8")) as UsageShape
  } catch {
    return {}
  }
}

function writeUsage(u: UsageShape): void {
  try {
    const up = usagePath()
    fs.mkdirSync(path.dirname(up), { recursive: true })
    fs.writeFileSync(up, JSON.stringify(u, null, 2))
  } catch (e) {
    log.warn("monitor", `Failed to write usage: ${(e as Error).message}`)
  }
}

export function bumpUsage(provider: string, inTok: number, outTok: number): void {
  const u = readUsage()
  if (!u[provider]) u[provider] = { todayRequests: 0, todayInputTokens: 0, todayOutputTokens: 0 }
  u[provider].todayRequests += 1
  u[provider].todayInputTokens += inTok
  u[provider].todayOutputTokens += outTok
  u[provider].lastUsed = new Date().toISOString()
  writeUsage(u)
}

export function supplySignals(): SupplySignal[] {
  const vault = loadVault()
  const usage = readUsage()
  const out: SupplySignal[] = []
  for (const provider of Object.keys(vault.providers)) {
    const list = vault.providers[provider]
    const activeKeys = list.filter((k) => k.status === "active").length
    const used = usage[provider]?.todayInputTokens + usage[provider]?.todayOutputTokens || 0
    const cap = 1_000_000 // generic upper bound; per-provider real caps live in config.ts
    out.push({
      provider,
      activeKeys,
      usedToday: used,
      dailyLimit: cap,
      ratio: cap ? used / cap : 0,
    })
  }
  return out
}

export function loadLevel(): SystemLoad {
  const cpus = os.cpus()?.length || 1
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const loadAvg = (os.loadavg()[0] || 0) / cpus
  const memRatio = 1 - freeMem / totalMem

  let level: SystemLoad["loadLevel"] = "low"
  if (loadAvg > 1.5 || memRatio > 0.85) level = "high"
  else if (loadAvg > 0.7 || memRatio > 0.65) level = "medium"
  return { cpu: loadAvg, memFree: freeMem, loadLevel: level }
}

export interface PredictionRow {
  provider: string
  activeKeys: number
  usedToday: number
  daysToExhaust: number | null
  status: "ok" | "warn" | "critical"
}

export function predictExhaustion(): PredictionRow[] {
  const signals = supplySignals()
  const rows: PredictionRow[] = []
  for (const s of signals) {
    const used = s.usedToday
    const limit = s.dailyLimit
    const ratio = s.ratio
    let status: PredictionRow["status"] = "ok"
    if (ratio > 0.9) status = "critical"
    else if (ratio > 0.75) status = "warn"
    // We can't really predict days without historical data; this is "today" only.
    const daysToExhaust = used >= limit ? 0 : limit > used ? Math.max(1, Math.floor((limit - used) / Math.max(used, 1))) : null
    rows.push({ provider: s.provider, activeKeys: s.activeKeys, usedToday: used, daysToExhaust, status })
  }
  return rows
}

export function pruneExpired(): { pruned: number } {
  const vault = loadVault()
  let pruned = 0
  const now = Date.now()
  for (const provider of Object.keys(vault.providers)) {
    const before = vault.providers[provider].length
    vault.providers[provider] = vault.providers[provider].filter((k) => {
      // Mark keys with too many failures as expired.
      const last = k.lastChecked ? Date.parse(k.lastChecked) : 0
      const stale = now - last > 1000 * 60 * 60 * 24 * 7 // 7 days
      const keep = !(k.failures >= 5 || (stale && k.source === "farm"))
      if (!keep) pruned++
      return keep
    })
    if (vault.providers[provider].length !== before) {
      log.info("monitor", `Pruned ${before - vault.providers[provider].length} expired key(s) from ${provider}`)
    }
  }
  saveVault(vault)
  return { pruned }
}

export function snapshot(): {
  supply: SupplySignal[]
  load: SystemLoad
  predictions: PredictionRow[]
} {
  return { supply: supplySignals(), load: loadLevel(), predictions: predictExhaustion() }
}