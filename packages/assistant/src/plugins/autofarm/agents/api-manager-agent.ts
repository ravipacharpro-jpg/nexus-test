// api-manager-agent: Manages the full API key lifecycle.
// - Scouting: finds new free LLM providers
// - Validation: probes each key (HTTP 200?)
// - Rotation: marks bad keys as invalid, tries next
// - Quota tracking: detects rate limits, finds alternatives
// - Auto-replace: when a key is dead, finds a backup
//
// This is the "system" the user asked for: smart enough to find
// free keys from anywhere on the internet, validate them, and
// keep the vault topped up automatically.

import { log } from "../lib/logger.ts"
import { scoutAll, freeAndCompatible, type ScoutedProvider } from "../lib/api-scout.ts"
import { loadVault, addKey as vaultAddKey, markKeyStatus, vaultSummary } from "../lib/vault.ts"
import { taskQueue } from "../lib/queue.ts"
import { sendWebhook } from "../lib/webhooks.ts"

export interface ManagedProvider {
  /** Provider id (matches config.ts FREE_PROVIDERS or custom). */
  id: string
  /** Free tier quota (requests/day). 0 = unknown. */
  freePerDay: number
  /** How many keys we currently hold. */
  keysHeld: number
  /** How many of those are active. */
  activeKeys: number
  /** Today's usage count. */
  usedToday: number
  /** Average daily usage from last 14 days. */
  avgDaily: number
  /** Health: 0..1 — 0 = many failures, 1 = all working. */
  health: number
  /** Status: ok | low | critical | expired. */
  status: "ok" | "low" | "critical" | "expired"
  /** Recommendation. */
  recommendation: "keep" | "rotate" | "add-more" | "remove"
}

export interface ManagerReport {
  ts: number
  providers: ManagedProvider[]
  totalActive: number
  totalDailyBudget: number
  totalUsedToday: number
  utilizationPct: number
  /** Action taken. */
  actions: string[]
  /** New candidates from latest scout. */
  candidates: ScoutedProvider[]
  /** Recommended next action. */
  nextAction: string
}

const USAGE_PATH = "/data/data/com.termux/files/home/.nexus/api-usage.json"

function readUsage(): Record<string, { todayRequests: number }> {
  try {
    if (typeof require === "function") {
      const fs = require("node:fs") as typeof import("node:fs")
      if (fs.existsSync(USAGE_PATH)) {
        return JSON.parse(fs.readFileSync(USAGE_PATH, "utf8")) as Record<string, { todayRequests: number }>
      }
    }
  } catch {}
  return {}
}

/** Read-only: list every provider with current health metrics. */
export function listManagedProviders(): ManagedProvider[] {
  const vault = loadVault()
  const usage = readUsage()
  const out: ManagedProvider[] = []
  for (const [id, entries] of Object.entries(vault.providers)) {
    const active = entries.filter((e) => e.status === "active").length
    const failed = entries.filter((e) => e.status === "invalid" || (e.failures ?? 0) >= 3).length
    const total = entries.length
    const used = usage[id]?.todayRequests ?? 0
    const freePerDay = inferFreePerDay(id)
    const utilization = freePerDay > 0 ? Math.min(1, used / freePerDay) : 0
    let status: ManagedProvider["status"] = "ok"
    if (failed > 0 && active === 0) status = "expired"
    else if (utilization > 0.9) status = "critical"
    else if (utilization > 0.7) status = "low"
    let recommendation: ManagedProvider["recommendation"] = "keep"
    if (status === "expired") recommendation = "remove"
    else if (status === "critical" || status === "low") recommendation = "add-more"
    else if (failed > 0) recommendation = "rotate"
    out.push({
      id,
      freePerDay,
      keysHeld: total,
      activeKeys: active,
      usedToday: used,
      avgDaily: 0, // would need history
      health: total > 0 ? active / total : 0,
      status,
      recommendation,
    })
  }
  return out
}

function inferFreePerDay(id: string): number {
  // Mirror config.ts FREE_PROVIDERS (so this works without import cycle)
  const map: Record<string, number> = {
    groq: 500_000, cerebras: 1_000_000, openrouter: 200_000,
    together_ai: 500_000, fireworks_ai: 500_000, mistral: 500_000,
    deepseek: 500_000, cohere: 500_000, perplexity: 500_000,
    huggingface: 500_000, gemini: 500_000, opencode: 500_000,
    anthropic: 500_000, xai: 500_000, replicate: 50_000,
  }
  return map[id] ?? 0
}

/** Main "manage" cycle: scout → evaluate → rotate → notify. */
export async function manageOnce(opts: {
  autoScout?: boolean
  autoAdd?: boolean
  autoRotate?: boolean
  autoNotify?: boolean
  scoutLimit?: number
} = {}): Promise<ManagerReport> {
  const autoScout = opts.autoScout ?? true
  const autoAdd = opts.autoAdd ?? true
  const autoRotate = opts.autoRotate ?? true
  const autoNotify = opts.autoNotify ?? true
  const scoutLimit = opts.scoutLimit ?? 20

  const actions: string[] = []
  const providers = listManagedProviders()
  const totalActive = providers.reduce((s, p) => s + p.activeKeys, 0)
  const totalDailyBudget = providers.reduce((s, p) => s + p.freePerDay * p.activeKeys, 0)
  const totalUsedToday = providers.reduce((s, p) => s + p.usedToday, 0)
  const utilizationPct = totalDailyBudget > 0 ? totalUsedToday / totalDailyBudget : 0

  // 1. Scout
  let candidates: ScoutedProvider[] = []
  if (autoScout) {
    try {
      const all = await scoutAll()
      candidates = freeAndCompatible(all).slice(0, scoutLimit)
      actions.push(`scouted ${all.length} candidates, ${candidates.length} free+openai-compat`)
      log.info("api-manager", `scout: ${all.length} raw, ${candidates.length} usable`)
    } catch (e) {
      log.warn("api-manager", `scout failed: ${(e as Error).message}`)
    }
  }

  // 2. Auto-rotate: mark bad keys as invalid
  if (autoRotate) {
    let rotated = 0
    const v = loadVault()
    for (const [provider, entries] of Object.entries(v.providers)) {
      for (const entry of entries) {
        if ((entry.failures ?? 0) >= 3 && entry.status !== "invalid") {
          markKeyStatus(provider, entry.key, "invalid")
          rotated++
        }
      }
    }
    if (rotated > 0) actions.push(`rotated ${rotated} dead keys`)
  }

  // 3. Auto-add: queue farm tasks for new candidates
  if (autoAdd && candidates.length > 0) {
    for (const c of candidates.slice(0, 3)) {
      const id = c.url.split("/")[2]?.split(".")[0]?.toLowerCase().replace(/[^a-z0-9]/g, "_") ?? "unknown"
      const task = taskQueue.push({
        type: "farm-provider",
        payload: { url: c.url, name: id, signupUrl: c.url, source: "scout", score: c.score },
        priority: 5,
      })
      actions.push(`queued farm task for ${id} (id=${task.id})`)
    }
  }

  // 4. Decide next action
  let nextAction = "monitor"
  const expired = providers.filter((p) => p.status === "expired").length
  const critical = providers.filter((p) => p.status === "critical").length
  if (expired > 0) nextAction = `rotate-or-remove ${expired} expired provider(s)`
  else if (critical > 0) nextAction = `add-more for ${critical} critical provider(s)`
  else if (utilizationPct > 0.5) nextAction = "monitor — utilization high, scout soon"
  else nextAction = "rest — everything healthy"

  // 5. Notify
  if (autoNotify && actions.length > 0) {
    const r = await sendWebhook({
      kind: actions.some((a) => a.includes("rotated")) ? "key-recovered" : "loop-started",
      message: `api-manager: ${actions.length} action(s)`,
      data: { actions: actions.slice(0, 5), utilization: utilizationPct },
    })
    if (r.fired > 0) actions.push(`notified ${r.fired} webhook(s)`)
  }

  return {
    ts: Date.now(),
    providers,
    totalActive,
    totalDailyBudget,
    totalUsedToday,
    utilizationPct,
    actions,
    candidates,
    nextAction,
  }
}
