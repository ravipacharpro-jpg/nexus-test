// Demand agent: watches the user's requests to know which models/providers
// are most wanted, and (optionally) queries the web for new free providers.

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { log } from "../lib/logger.ts"
import type { DemandSignal } from "../lib/types.ts"

const DEMAND_PATH = path.join(os.homedir(), ".nexus", "autofarm", "demand.json")
const MAX_DEMAND_ENTRIES = 200

function readDemand(): DemandSignal[] {
  try {
    if (!fs.existsSync(DEMAND_PATH)) return []
    return JSON.parse(fs.readFileSync(DEMAND_PATH, "utf8")) as DemandSignal[]
  } catch {
    return []
  }
}

function writeDemand(d: DemandSignal[]): void {
  try {
    fs.mkdirSync(path.dirname(DEMAND_PATH), { recursive: true })
    fs.writeFileSync(DEMAND_PATH, JSON.stringify(d.slice(-MAX_DEMAND_ENTRIES), null, 2))
  } catch (e) {
    log.warn("demand", `Failed to write demand: ${(e as Error).message}`)
  }
}

export function record(model: string, tokens: number, priority: DemandSignal["priority"] = "normal"): void {
  const list = readDemand()
  list.push({
    model,
    requestedTokens: tokens,
    requestedAt: new Date().toISOString(),
    priority,
  })
  writeDemand(list)
  log.debug("demand", `recorded ${model} (${tokens} tokens)`)
}

export function topModels(limit = 10): { model: string; tokens: number; count: number }[] {
  const list = readDemand()
  const agg = new Map<string, { tokens: number; count: number }>()
  for (const d of list) {
    const e = agg.get(d.model) || { tokens: 0, count: 0 }
    e.tokens += d.requestedTokens
    e.count += 1
    agg.set(d.model, e)
  }
  return [...agg.entries()]
    .sort((a, b) => b[1].tokens - a[1].tokens)
    .slice(0, limit)
    .map(([model, v]) => ({ model, tokens: v.tokens, count: v.count }))
}

export function totalDemand(): number {
  return readDemand().reduce((acc, d) => acc + d.requestedTokens, 0)
}

export interface WebDiscovery {
  source: string
  title: string
  url: string
  provider?: string
  freePerDay?: number
  models?: string[]
}

/**
 * Search the web (DuckDuckGo HTML) for "free LLM API" providers.
 * Returns a small list of plausible matches — we never auto-add them,
 * just surface them to the orchestrator for human review.
 */
export async function discoverProviders(): Promise<WebDiscovery[]> {
  const query = "free LLM API key no credit card 2026"
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  try {
    const ctl = new AbortController()
    const tid = setTimeout(() => ctl.abort(), 12_000)
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: ctl.signal })
    clearTimeout(tid)
    if (!res.ok) return []
    const html = await res.text()
    const results: WebDiscovery[] = []
    const re = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g
    let m: RegExpExecArray | null
    let count = 0
    while ((m = re.exec(html)) && count < 15) {
      const link = m[1]
      const title = m[2]
      // Skip non-provider pages.
      if (!/api|inference|llm|model|key/i.test(title)) continue
      results.push({ source: "duckduckgo", title, url: link })
      count++
    }
    log.info("demand", `Discovered ${results.length} candidate providers`)
    return results
  } catch (e) {
    log.warn("demand", `discoverProviders failed: ${(e as Error).message}`)
    return []
  }
}