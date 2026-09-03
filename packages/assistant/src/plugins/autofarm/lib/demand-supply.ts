// Demand-supply engine for NEXUS autofarm
// The brain that ties everything together:
//   1. Reads current demand (which models user wants)
//   2. Reads current supply (which keys we have, what's exhausted)
//   3. If supply < demand → discover + validate new providers
//   4. Auto-add validated providers to the catalog
//   5. Trigger farming (queue create-gmail + farm-provider tasks)
//
// Why: the previous orchestrator only used 13 hardcoded providers. This
// engine makes NEXUS truly self-extending: when demand exceeds supply,
// it hunts for new free LLM providers on the web automatically.

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { log } from "./logger.ts"
import { discoverAll, type ProviderCandidate } from "./discovery.ts"
import { validateAll, reticleVerify, type ValidationResult } from "./validator.ts"
import { suggestProviderId } from "./validator.ts"
import { FREE_PROVIDERS, type FreeProvider } from "./config.ts"
import { record as recordDemand, topModels as topDemand } from "../agents/demand-agent.ts"
import { taskQueue } from "./queue.ts"
import { sendWebhook } from "./webhooks.ts"
import { assert as reticleAssert, isReticleInstalled as reticleInstalled } from "./reticle.ts"

const STATE_PATH = path.join(os.homedir(), ".nexus", "autofarm", "demand-supply.json")

export interface SupplySnapshot {
  providers: { id: string; label: string; activeKeys: number; usedToday: number; dailyLimit: number }[]
  totalActive: number
  totalDailyBudget: number
  totalUsedToday: number
  ratio: number
}

export interface DemandSnapshot {
  models: { model: string; tokens: number; count: number }[]
  totalTokens: number
  topProvider: string | null
  hotness: number // 0..1
}

export interface DecisionResult {
  status: "surplus" | "balanced" | "low" | "critical" | "discovering"
  gap: number
  ratio: number
  recommendation: "rest" | "monitor" | "discover" | "farm-now" | "urgent-farm"
  reasoning: string
  discoveredCount: number
  validatedCount: number
  queuedTasks: string[]
}

/** Read the current supply (keys, usage) from the vault + usage log. */
export function snapshotSupply(): SupplySnapshot {
  const vp = path.join(os.homedir(), ".nexus", "api-vault.json")
  const up = path.join(os.homedir(), ".nexus", "api-usage.json")
  const vault: { providers?: Record<string, Array<{ status: string }>>; usage?: Record<string, { todayRequests: number }> } = {}
  try { if (fs.existsSync(vp)) Object.assign(vault, JSON.parse(fs.readFileSync(vp, "utf8"))) } catch {}
  try { if (fs.existsSync(up)) vault.usage = (JSON.parse(fs.readFileSync(up, "utf8")) as { usage?: Record<string, { todayRequests: number }> }).usage ?? {} } catch {}

  // Map known providers to their declared daily limits
  const freeById = new Map<string, FreeProvider>()
  for (const p of FREE_PROVIDERS) freeById.set(p.name, p)

  const providers: SupplySnapshot["providers"] = []
  let totalActive = 0
  let totalDailyBudget = 0
  let totalUsedToday = 0
  const allProviders = new Set<string>([...Object.keys(vault.providers ?? {}), ...freeById.keys()])
  for (const id of allProviders) {
    const free = freeById.get(id)
    const limit = free?.freePerDay ?? 0
    const entries = vault.providers?.[id] ?? []
    const active = entries.filter((e) => e.status === "active" || e.status === "unknown").length
    const used = vault.usage?.[id]?.todayRequests ?? 0
    providers.push({
      id,
      label: free?.label ?? id,
      activeKeys: active,
      usedToday: used,
      dailyLimit: limit,
    })
    totalActive += active
    totalDailyBudget += limit * Math.max(active, 1)
    totalUsedToday += used
  }
  const ratio = totalDailyBudget > 0 ? totalUsedToday / totalDailyBudget : 0
  return { providers, totalActive, totalDailyBudget, totalUsedToday, ratio }
}

/** Read the current demand from recorded signals. */
export function snapshotDemand(): DemandSnapshot {
  const top = topDemand(10)
  const totalTokens = top.reduce((s, m) => s + m.tokens, 0)
  const topProvider = top.length ? top[0].model : null
  // hotness: 0..1 based on count of distinct models requested
  const hotness = Math.min(1, top.length / 5)
  return { models: top, totalTokens, topProvider, hotness }
}

/** The core decision function. */
export function decide(): DecisionResult {
  const supply = snapshotSupply()
  const demand = snapshotDemand()
  const gap = Math.max(0, demand.hotness * 10 - supply.totalActive)
  const ratio = supply.ratio

  let status: DecisionResult["status"] = "balanced"
  let recommendation: DecisionResult["recommendation"] = "monitor"
  let reasoning = "supply and demand in balance"

  if (ratio >= 0.9) {
    status = "critical"
    recommendation = "urgent-farm"
    reasoning = `ratio ${(ratio * 100).toFixed(0)}% — daily budget nearly exhausted`
  } else if (ratio >= 0.7) {
    status = "low"
    recommendation = "farm-now"
    reasoning = `ratio ${(ratio * 100).toFixed(0)}% — getting close to limit`
  } else if (gap > 0) {
    status = "low"
    recommendation = "discover"
    reasoning = `${demand.hotness.toFixed(2)} hotness but only ${supply.totalActive} active keys — hunt new providers`
  } else if (ratio < 0.3 && supply.totalActive > 5) {
    status = "surplus"
    recommendation = "rest"
    reasoning = `surplus: ${supply.totalActive} keys, only ${(ratio * 100).toFixed(0)}% used`
  } else {
    status = "balanced"
    recommendation = "monitor"
    reasoning = `ratio ${(ratio * 100).toFixed(0)}%, ${supply.totalActive} active keys`
  }
  return { status, gap, ratio, recommendation, reasoning, discoveredCount: 0, validatedCount: 0, queuedTasks: [] }
}

export interface RunResult {
  decision: DecisionResult
  discovered: ProviderCandidate[]
  validated: ValidationResult[]
  addedToCatalog: string[]
  queuedTasks: string[]
  notified: string[]
  ms: number
}

/** Run the full demand-supply cycle. */
export async function runOnce(opts: { autoAdd?: boolean; autoFarm?: boolean; autoNotify?: boolean; discoverLimit?: number } = {}): Promise<RunResult> {
  const t0 = Date.now()
  const autoAdd = opts.autoAdd ?? true
  const autoFarm = opts.autoFarm ?? true
  const autoNotify = opts.autoNotify ?? true

  const decision = decide()
  log.info("demand-supply", `status=${decision.status} ratio=${decision.ratio.toFixed(2)} recommendation=${decision.recommendation}`)

  let discovered: ProviderCandidate[] = []
  let validated: ValidationResult[] = []
  let added: string[] = []
  const queued: string[] = []

  if (decision.recommendation === "discover" || decision.recommendation === "urgent-farm") {
    discovered = await discoverAll()
    decision.discoveredCount = discovered.length
    log.info("demand-supply", `discovered ${discovered.length} candidates`)
    if (discovered.length) {
      const urls = Array.from(new Set(discovered.map((d) => d.url))).slice(0, opts.discoverLimit ?? 10)
      // First pass: cheap heuristic validate
      const shallow = await validateAll(urls, 5)
      // Second pass: deep verify (try /v1/models) only for those that passed the shallow test
      const deepPromises = shallow
        .filter((v) => v.score >= 0.3 && !v.error)
        .map((v) => reticleVerify(v.url, v.title).then((dv) => ({ ...v, deepScore: dv.deepScore, modelCount: dv.modelCount, modelsEndpoint: dv.modelsEndpoint })))
      const deep = await Promise.all(deepPromises)
      validated = deep.length ? deep : shallow
      decision.validatedCount = validated.filter((v) => (v as ValidationResult & { deepScore?: number }).deepScore !== undefined ? (v as ValidationResult & { deepScore: number }).deepScore >= 0.5 : v.score >= 0.5).length
      log.info("demand-supply", `validated ${validated.length} (${decision.validatedCount} deep-score>=0.5)`)

      // If Reticle is available, run an end-to-end assert on the top candidate
      const reticle = await reticleInstalled()
      if (reticle) {
        const top = [...validated].sort((a, b) => {
          const sa = (a as ValidationResult & { deepScore?: number }).deepScore ?? a.score
          const sb = (b as ValidationResult & { deepScore?: number }).deepScore ?? b.score
          return sb - sa
        })[0]
        if (top) {
          const v = await reticleAssert({
            allOf: [
              { kind: "net", urlContains: "/v1/models", status: 200, count: 1 },
              { kind: "console", level: "error", absent: true },
            ],
            claim: `verify ${top.title} is reachable and exposes models`,
            timeoutMs: 15_000,
          })
          log.info("demand-supply", `reticle verdict for ${top.title}: ${v.verdict}${v.failureReason ? " — " + v.failureReason : ""}`)
        }
      }

      if (autoAdd) {
        for (const v of validated) {
          const score = (v as ValidationResult & { deepScore?: number }).deepScore ?? v.score
          if (score < 0.5 || !v.hasFreeTier) continue
          if (addProviderToCatalog(v, discovered.find((d) => d.url === v.url))) {
            added.push(suggestProviderId(v.url, v.title))
          }
        }
      }
    }
  }

  if (autoFarm && (decision.recommendation === "farm-now" || decision.recommendation === "urgent-farm" || added.length > 0)) {
    const createTask = taskQueue.push({ type: "create-gmail", payload: { count: 1, reason: "demand-supply" }, priority: 8 })
    queued.push(createTask.id)
    const farmTask = taskQueue.push({ type: "farm-provider", payload: { targets: added.length ? added : ["groq", "cerebras"] }, priority: 7 })
    queued.push(farmTask.id)
    log.info("demand-supply", `queued 2 tasks: ${createTask.id}, ${farmTask.id}`)
  }

  const notified: string[] = []
  if (autoNotify) {
    const r = await sendWebhook({
      kind: decision.recommendation === "urgent-farm" ? "key-exhausted" : decision.recommendation === "discover" ? "anomaly-detected" : "loop-started",
      message: `demand-supply: ${decision.recommendation} — ${decision.reasoning}`,
      data: { discovered: discovered.length, validated: decision.validatedCount, added: added.length, queued: queued.length },
    })
    notified.push(...(r.errors.length ? r.errors.map((e) => `${e.target}:FAIL`) : ["ok"]))
  }

  // Persist state
  const state = { ts: Date.now(), decision, discovered: discovered.length, validated: decision.validatedCount, added, queued }
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
  } catch {}

  return { decision, discovered, validated, addedToCatalog: added, queuedTasks: queued, notified, ms: Date.now() - t0 }
}

// ── Catalog management ──────────────────────────────────────────────
const CATALOG_PATH = path.join(os.homedir(), ".nexus", "autofarm", "catalog.json")

interface CatalogShape { providers: FreeProvider[] }

function readCatalog(): CatalogShape {
  try {
    if (!fs.existsSync(CATALOG_PATH)) return { providers: [] }
    return JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8")) as CatalogShape
  } catch { return { providers: [] } }
}

function writeCatalog(c: CatalogShape): void {
  try {
    fs.mkdirSync(path.dirname(CATALOG_PATH), { recursive: true })
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(c, null, 2))
  } catch (e) {
    log.error("catalog", `write failed: ${(e as Error).message}`)
  }
}

function addProviderToCatalog(v: ValidationResult, c?: ProviderCandidate): boolean {
  const id = suggestProviderId(v.url, v.title)
  const cat = readCatalog()
  if (cat.providers.some((p) => p.name === id)) return false
  const freePerDay = /unlimited|generous/i.test(v.freeTierHint ?? "") ? 1_000_000 : 100_000
  cat.providers.push({
    name: id,
    label: v.title.slice(0, 50) || id,
    freeTier: true,
    freePerDay,
    url: v.url,
    baseUrl: v.url.replace(/\/+$/, ""),
    models: ["auto"],
    maxKeys: 2,
    signupUrl: v.url,
    signupFields: { email: "email", password: "password" },
    notes: `auto-discovered via demand-supply (score=${v.score.toFixed(2)}, src=${c?.source ?? "manual"})`,
  })
  writeCatalog(cat)
  log.ok("catalog", `added ${id} (freePerDay=${freePerDay})`)
  return true
}

export function listCustomProviders(): FreeProvider[] {
  return readCatalog().providers
}

export function removeCustomProvider(id: string): boolean {
  const cat = readCatalog()
  const before = cat.providers.length
  cat.providers = cat.providers.filter((p) => p.name !== id)
  if (cat.providers.length < before) {
    writeCatalog(cat)
    return true
  }
  return false
}

export function statePath(): string { return STATE_PATH }
export function catalogPath(): string { return CATALOG_PATH }
