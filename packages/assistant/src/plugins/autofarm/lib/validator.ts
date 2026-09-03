// Auto-validator for discovered provider candidates
// Probes each candidate URL to determine:
//   1. Does it have an OpenAI-compatible /v1/models endpoint?
//   2. Does it have a signup page?
//   3. Does it actually offer a free tier?
//
// Why: a "discovered provider" is just a URL. Without validation we add
// junk to the catalog. This module makes the discovery → catalog loop
// truly autonomous.

export interface ValidationResult {
  url: string
  title: string
  ok: boolean
  hasOpenAICompat: boolean
  hasSignup: boolean
  hasFreeTier: boolean
  freeTierHint: string | null
  modelCount: number
  latencyMs: number
  error?: string
  score: number // 0..1, higher = better candidate
}

const FREE_TIER_KEYWORDS = [
  /free\s*tier/i, /no\s*credit\s*card/i, /\bfree\s+api\b/i,
  /free\s+credits?/i, /free\s+trial/i, /pay\s*as\s*you\s*go.*free/i,
  /\bget\s+started\s+free\b/i, /\bfree\s+for\s+developers\b/i,
  /\bgenerous\s+free\s*tier\b/i,
]

const OPENAI_COMPAT_HINTS = [
  /openai[\s-]compatible/i, /\/v1\/models/i, /\/v1\/chat\/completions/i,
  /chat\s*completions/i, /^\s*openai\s*$/im, /compatible\s*with\s*openai/i,
]

const SIGNUP_HINTS = [
  /sign\s*up/i, /create\s*account/i, /get\s*started/i, /register/i,
  /\/signup/i, /\/register/i, /\/login/i, /\bconsole\./i,
]

interface ProbeResult {
  hasOpenAICompat: boolean
  hasSignup: boolean
  hasFreeTier: boolean
  freeTierHint: string | null
  modelCount: number
  latencyMs: number
  error?: string
}

/** Heuristic probe: fetch the page, look for hints. */
async function probe(url: string, timeoutMs = 6_000): Promise<ProbeResult> {
  const t0 = Date.now()
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
      signal: ctl.signal,
      redirect: "follow",
    })
    clearTimeout(timer)
    const latencyMs = Date.now() - t0
    if (!r.ok) return { hasOpenAICompat: false, hasSignup: false, hasFreeTier: false, freeTierHint: null, modelCount: 0, latencyMs, error: `HTTP ${r.status}` }
    const text = (await r.text()).slice(0, 100_000)
    const lower = text.toLowerCase()
    const hasOpenAICompat = OPENAI_COMPAT_HINTS.some((re) => re.test(lower))
    const hasSignup = SIGNUP_HINTS.some((re) => re.test(lower))
    const freeMatch = FREE_TIER_KEYWORDS.find((re) => re.test(lower))
    const hasFreeTier = Boolean(freeMatch)
    const freeTierHint = freeMatch ? freeMatch.source : null
    return { hasOpenAICompat, hasSignup, hasFreeTier, freeTierHint, modelCount: 0, latencyMs }
  } catch (e) {
    return { hasOpenAICompat: false, hasSignup: false, hasFreeTier: false, freeTierHint: null, modelCount: 0, latencyMs: Date.now() - t0, error: (e as Error).message }
  }
}

/** Compute a 0..1 score from probe result. */
function scoreFromProbe(p: ProbeResult): number {
  if (p.error) return 0
  let s = 0
  if (p.hasOpenAICompat) s += 0.5
  if (p.hasSignup) s += 0.2
  if (p.hasFreeTier) s += 0.3
  return Math.min(1, s)
}

export async function validateCandidate(url: string, title = ""): Promise<ValidationResult> {
  const p = await probe(url)
  return {
    url,
    title,
    ok: !p.error,
    hasOpenAICompat: p.hasOpenAICompat,
    hasSignup: p.hasSignup,
    hasFreeTier: p.hasFreeTier,
    freeTierHint: p.freeTierHint,
    modelCount: p.modelCount,
    latencyMs: p.latencyMs,
    error: p.error,
    score: scoreFromProbe(p),
  }
}

/** Validate multiple candidates in parallel with concurrency cap. */
export async function validateAll(urls: string[], concurrency = 5, timeoutMs = 6_000): Promise<ValidationResult[]> {
  const out: ValidationResult[] = []
  let i = 0
  async function worker() {
    while (i < urls.length) {
      const idx = i++
      out[idx] = await validateCandidate(urls[idx])
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return out
}

/**
 * Reticle-style deep verification: like validateAll, but also tries the
 * `/v1/models` endpoint (if the base URL exposes one) and gives a 0..1
 * confidence score that combines all signals.
 */
export async function reticleVerify(url: string, title = "", timeoutMs = 8_000): Promise<ValidationResult & { deepScore: number; modelsEndpoint: boolean }> {
  const v = await validateCandidate(url, title)
  let modelsEndpoint = false
  let modelsOk = false
  let modelCount = 0
  try {
    const base = baseUrl(url)
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    // Try common OpenAI-compatible models endpoints
    for (const p of ["/v1/models", "/api/v1/models", "/models"]) {
      try {
        const r = await fetch(`${base}${p}`, { headers: { "User-Agent": "nexus-reticle/1.0" }, signal: ctl.signal })
        if (r.ok) {
          modelsEndpoint = true
          const data = (await r.json().catch(() => ({}))) as { data?: unknown[]; models?: unknown[] }
          const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : []
          if (list.length > 0) { modelsOk = true; modelCount = list.length; break }
        }
      } catch { /* try next */ }
    }
    clearTimeout(timer)
  } catch { /* keep going */ }
  // Combine: base score (heuristics) + models endpoint bonus + models ok bonus
  let deepScore = v.score
  if (modelsEndpoint) deepScore += 0.15
  if (modelsOk) deepScore += 0.2
  deepScore = Math.min(1, deepScore)
  return { ...v, modelCount, deepScore, modelsEndpoint }
}

/** Extract base URL from a discovery URL. */
export function baseUrl(url: string): string {
  try { return new URL(url).origin } catch { return url }
}

/** Suggest a provider id from a URL. */
export function suggestProviderId(url: string, title: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "")
    const first = host.split(".")[0]
    return first.replace(/[^a-z0-9]/g, "_")
  } catch {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24)
  }
}
