// symbolic-chain: a "symbolic link" of providers that automatically
// fails over to the next when the current one runs out of quota, 429s,
// or returns 401 (key revoked). The chain is a try/catch in disguise:
//   1. Try provider A → ok → done
//   2. Rate-limited? → mark A as cooling, try B
//   3. B fails too? → C
//   4. All cooling? → wait for the soonest-to-reset, then retry
//
// This is the "agent ke andar symbal link" the user asked for:
// one virtual endpoint, multiple real providers, transparent failover.

import { log } from "./logger.ts"
import { getAllKeys, markKeyStatus } from "./vault.ts"
import { FREE_PROVIDERS, getProvider } from "./config.ts"

export interface ChainHop {
  provider: string
  key?: string
  tried: boolean
  result: "ok" | "rate-limited" | "auth" | "unreachable" | "no-key" | "skipped"
  error?: string
  latencyMs: number
}

export interface ChainResult {
  ok: boolean
  /** The hop that finally succeeded (null if all failed). */
  winner: ChainHop | null
  /** All hops tried in order. */
  hops: ChainHop[]
  /** Total elapsed ms. */
  totalMs: number
  /** User-facing summary. */
  summary: string
}

export interface ChainOptions {
  /** Preferred provider first. */
  preferred?: string
  /** Providers to exclude (e.g. known dead). */
  exclude?: string[]
  /** Maximum hops (default 6). */
  maxHops?: number
  /** Cooldown tracker callback — called when a provider is marked cooling. */
  onCooldown?: (provider: string, ms: number) => void
}

// in-process cooldown registry (provider -> until-ts)
const COOLDOWN: Map<string, number> = new Map()

export function setCooldown(provider: string, ms: number): void {
  COOLDOWN.set(provider, Date.now() + ms)
  log.info("chain", `${provider} cooling for ${ms}ms`)
}

export function clearCooldown(provider: string): void {
  COOLDOWN.delete(provider)
}

function isCooling(provider: string): number {
  const until = COOLDOWN.get(provider) ?? 0
  if (Date.now() > until) {
    COOLDOWN.delete(provider)
    return 0
  }
  return until - Date.now()
}

const COOLDOWN_MS: Record<string, number> = {
  "rate-limited": 60_000,        // 1 min
  auth: 5 * 60_000,              // 5 min for bad key
  unreachable: 30_000,           // 30 s for transient
}

async function tryHop(provider: string, key: string | undefined): Promise<ChainHop> {
  const t0 = Date.now()
  const hop: ChainHop = { provider, key: key ? maskKey(key) : undefined, tried: true, result: "skipped", latencyMs: 0 }
  if (!key) {
    hop.result = "no-key"
    return hop
  }
  const p = getProvider(provider)
  if (!p) {
    hop.result = "unreachable"
    hop.error = "unknown provider"
    return hop
  }
  try {
    const ctl = new AbortController()
    const tid = setTimeout(() => ctl.abort(), 10_000)
    const headers: Record<string, string> = provider === "anthropic"
      ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${key}` }
    const res = await fetch(p.baseUrl + "/models", { headers, signal: ctl.signal })
    clearTimeout(tid)
    hop.latencyMs = Date.now() - t0
    if (res.ok) {
      hop.result = "ok"
      return hop
    }
    if (res.status === 429) {
      hop.result = "rate-limited"
      hop.error = `HTTP 429`
      setCooldown(provider, COOLDOWN_MS["rate-limited"])
      return hop
    }
    if (res.status === 401 || res.status === 403) {
      hop.result = "auth"
      hop.error = `HTTP ${res.status}`
      try { if (key) markKeyStatus(provider, key, "invalid") } catch {}
      setCooldown(provider, COOLDOWN_MS["auth"])
      return hop
    }
    hop.result = "unreachable"
    hop.error = `HTTP ${res.status}`
    setCooldown(provider, COOLDOWN_MS["unreachable"])
    return hop
  } catch (e) {
    hop.latencyMs = Date.now() - t0
    hop.result = "unreachable"
    hop.error = (e as Error).message
    setCooldown(provider, COOLDOWN_MS["unreachable"])
    return hop
  }
}

function maskKey(k: string): string {
  if (k.length <= 8) return "***"
  return k.slice(0, 4) + "***" + k.slice(-4)
}

/** Build a symbolic chain: try providers in order, fail over on errors. */
export async function runChain(opts: ChainOptions = {}): Promise<ChainResult> {
  const t0 = Date.now()
  const hops: ChainHop[] = []
  const max = opts.maxHops ?? 6
  const exclude = new Set(opts.exclude ?? [])
  const order: string[] = []
  if (opts.preferred) order.push(opts.preferred)
  for (const p of FREE_PROVIDERS) {
    if (!order.includes(p.name) && !exclude.has(p.name)) order.push(p.name)
  }

  let winner: ChainHop | null = null
  for (const name of order.slice(0, max)) {
    if (exclude.has(name)) continue
    const cooling = isCooling(name)
    if (cooling > 0) {
      hops.push({ provider: name, tried: false, result: "skipped", error: `cooling for ${Math.ceil(cooling / 1000)}s`, latencyMs: 0 })
      continue
    }
    const all = getAllKeys()
    const v = all.find((x) => x.provider === name && x.entry.status === "active")
    const hop = await tryHop(name, v?.entry.key)
    hops.push(hop)
    if (hop.result === "ok") {
      winner = hop
      break
    }
  }

  if (!winner) {
    // All hops failed. If there is a soonest-cooldown entry, mention it.
    const cools = [...COOLDOWN.entries()].sort((a, b) => a[1] - b[1])
    const soonest = cools[0]
    const waitHint = soonest ? ` (next retry in ${Math.ceil((soonest[1] - Date.now()) / 1000)}s on ${soonest[0]})` : ""
    return {
      ok: false,
      winner: null,
      hops,
      totalMs: Date.now() - t0,
      summary: `all ${hops.length} hops failed${waitHint}`,
    }
  }

  return {
    ok: true,
    winner,
    hops,
    totalMs: Date.now() - t0,
    summary: `succeeded via ${winner.provider} in ${winner.latencyMs}ms (${hops.length} hop(s))`,
  }
}

export function getCooldownSnapshot(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of COOLDOWN) {
    const remain = v - Date.now()
    if (remain > 0) out[k] = Math.ceil(remain / 1000)
  }
  return out
}
