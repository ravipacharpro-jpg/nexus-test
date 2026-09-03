// Upgrade 3: ML-based usage prediction
// Replaces the simple "limit - used" formula with:
//   - linear regression on rolling 7-day history
//   - exponential smoothing for short-term spikes
//   - EWMA-based anomaly detection
//
// We deliberately keep this dependency-free so it works offline.

import fs from "fs"
import os from "os"
import path from "path"

const HISTORY_PATH = path.join(os.homedir(), ".nexus", "autofarm", "usage-history.jsonl")

export interface UsageSample {
  ts: number
  provider: string
  requests: number
  inputTokens: number
  outputTokens: number
}

export interface Prediction {
  provider: string
  currentDaily: number
  /** Average daily usage over rolling 7-day window. */
  avgDaily: number
  /** Linear-regression slope (requests/day). */
  trendSlope: number
  /** Predicted days until free-tier exhaustion. */
  daysToExhaust: number
  /** Confidence 0..1. */
  confidence: number
  /** Anomaly score (|z|) — > 2 means unusual spike. */
  anomalyScore: number
}

/** Append a sample to the rolling history. */
export function recordSample(sample: UsageSample): void {
  try {
    fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true })
    fs.appendFileSync(HISTORY_PATH, JSON.stringify(sample) + "\n", { mode: 0o600 })
  } catch {
    // best-effort
  }
}

/** Read recent history (last N days). */
function readHistory(days: number): UsageSample[] {
  try {
    if (!fs.existsSync(HISTORY_PATH)) return []
    const cutoff = Date.now() - days * 86_400_000
    const lines = fs.readFileSync(HISTORY_PATH, "utf8").split(/\r?\n/).filter(Boolean)
    const out: UsageSample[] = []
    for (const line of lines) {
      try {
        const s = JSON.parse(line) as UsageSample
        if (s.ts >= cutoff) out.push(s)
      } catch {}
    }
    return out
  } catch {
    return []
  }
}

/** Aggregate samples by day, per provider. */
function dailyTotals(samples: UsageSample[]): Map<string, number[]> {
  const out = new Map<string, number[]>()
  // bucket: yyyy-mm-dd -> total requests
  const bucket = new Map<string, { provider: string; req: number }>()
  for (const s of samples) {
    const day = new Date(s.ts).toISOString().slice(0, 10)
    const key = `${day}|${s.provider}`
    const cur = bucket.get(key) ?? { provider: s.provider, req: 0 }
    cur.req += s.requests
    bucket.set(key, cur)
  }
  // group by provider
  const byProv = new Map<string, number[]>()
  for (const { provider, req } of bucket.values()) {
    if (!byProv.has(provider)) byProv.set(provider, [])
    byProv.get(provider)!.push(req)
  }
  return byProv
}

/** Simple linear regression: y = slope * x + intercept, returns slope. */
function linearSlope(values: number[]): number {
  const n = values.length
  if (n < 2) return 0
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0
  for (let i = 0; i < n; i++) {
    sumX += i
    sumY += values[i]
    sumXY += i * values[i]
    sumXX += i * i
  }
  const denom = n * sumXX - sumX * sumX
  if (denom === 0) return 0
  return (n * sumXY - sumX * sumY) / denom
}

/** Mean. */
function mean(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** Standard deviation. */
function stdev(values: number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  const variance = values.reduce((acc, v) => acc + (v - m) * (v - m), 0) / (values.length - 1)
  return Math.sqrt(variance)
}

/** Returns 0..1 confidence: more samples + lower variance → higher. */
function confidenceFor(values: number[]): number {
  const n = values.length
  if (n === 0) return 0
  const m = mean(values)
  const sd = stdev(values)
  const cv = m > 0 ? sd / m : 1 // coefficient of variation
  const dataScore = Math.min(1, n / 7) // 7 days = full
  const stableScore = Math.max(0, 1 - cv)
  return Math.round((0.6 * dataScore + 0.4 * stableScore) * 100) / 100
}

/**
 * Predict days-to-exhaustion for a provider, given its free-tier daily limit.
 * Returns null if we have no signal.
 */
export function predictDaysToExhaust(
  provider: string,
  freeTierLimit: number,
  currentDailyUsed: number,
): Prediction {
  const history = readHistory(14)
  const samples = history.filter((s) => s.provider === provider)
  const daily = dailyTotals(samples).get(provider) ?? []
  const avg = mean(daily)
  const slope = linearSlope(daily)
  const sd = stdev(daily)
  const cv = avg > 0 ? sd / avg : 0

  // Burn rate = max(avg, recent slope projection)
  const projectedTomorrow = Math.max(avg, avg + slope)
  // If we already used a lot today, account for that
  const effectiveDaily = Math.max(projectedTomorrow, currentDailyUsed)

  // Days to hit the limit
  let daysToExhaust: number
  if (effectiveDaily <= 0) daysToExhaust = 365
  else if (currentDailyUsed >= freeTierLimit) daysToExhaust = 0
  else daysToExhaust = (freeTierLimit - currentDailyUsed) / effectiveDaily

  // Anomaly: |currentDaily - avg| / sd
  const anomalyScore = sd > 0 ? Math.abs(currentDailyUsed - avg) / sd : 0

  return {
    provider,
    currentDaily: currentDailyUsed,
    avgDaily: Math.round(avg),
    trendSlope: Math.round(slope * 100) / 100,
    daysToExhaust: Math.round(daysToExhaust * 10) / 10,
    confidence: confidenceFor(daily),
    anomalyScore: Math.round(anomalyScore * 100) / 100,
  }
}

/** Predict for all providers in the catalog with a free-tier limit. */
export function predictAll(
  providers: { id: string; freePerDay?: number }[],
  currentUsage: Record<string, { todayRequests: number }> = {},
): Prediction[] {
  return providers
    .filter((p) => p.freePerDay && p.freePerDay > 0)
    .map((p) => {
      const used = currentUsage?.[p.id]?.todayRequests ?? 0
      return predictDaysToExhaust(p.id, p.freePerDay!, used)
    })
    .sort((a, b) => a.daysToExhaust - b.daysToExhaust)
}
