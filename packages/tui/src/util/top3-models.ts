// top3-models: pick the top 3 best free+fast+available models for the model switcher.
//
// Source of providers (in priority order):
//   1. Keyless gateways: opencode (opencode.ai), omniroute (local script server on :20128)
//   2. Vault farm keys: ~/.nexus/api-vault.json — every active "farm" key under providers/*
//
// Each candidate provider is:
//   - Live-pinged at /models to confirm it speaks OpenAI-compatible
//   - Filtered for free + fast + decent context
//   - Scored: speed(0.4) + quality(0.4) + freshness(0.2) + task bonus
//   - Health-probed with the actual API key (or keyless when no key is required)
//
// "freshness" means the live /models response is treated as the source of truth:
//   - New models the provider adds today automatically become candidates
//   - Models that disappear from /models drop out of the list
//   - Paid-only or rate-limited models are filtered out by the "free" regex
//
// Failed probes are dropped. The function is intentionally tolerant: any provider
// that errors out, times out, or returns no usable model is silently skipped.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export interface Top3Candidate {
  provider: string
  model: string
  score: number
  latencyMs: number
  context: number
  source: "keyless" | "farm"
  probed: "ok" | "skipped"
  error?: string
}

export interface Top3Options {
  /** How many to return (default 3). */
  topN?: number
  /** Skip the live health probe (faster, less safe). */
  skipProbe?: boolean
  /** Per-probe timeout in ms (default 6000). */
  timeoutMs?: number
  /** Override vault path (default ~/.nexus/api-vault.json). */
  vaultPath?: string
}

const QUALITY_HINTS: Array<{ re: RegExp; score: number }> = [
  { re: /llama-3\.1-?70b|llama-3\.3-?70b|qwen-2\.5-?72b|mixtral-8x22b|deepseek-v3|claude-3-5-sonnet|gpt-4o|gemini-1\.5-pro/i, score: 0.95 },
  { re: /llama-3\.1-?8b|llama-3\.3-?8b|mistral-?(large|small)-latest|qwen-2\.5-?7b|deepseek-chat|gpt-4o-mini|gemini-1\.5-flash|grok-?(beta|vision)/i, score: 0.8 },
  { re: /llama-3\.2|phi-3|phi-3\.5|gemma-?2|mistral-7b|qwen-?1\.5/i, score: 0.7 },
  { re: /gpt-3\.5|turbo-16k|claude-3-haiku/i, score: 0.65 },
]

function qualityOf(model: string): number {
  for (const h of QUALITY_HINTS) if (h.re.test(model)) return h.score
  return 0.55
}

const CONTEXT_HINTS: Array<{ re: RegExp; ctx: number }> = [
  { re: /128k|200k|1m|2m/i, ctx: 1_000_000 },
  { re: /32k|64k/i, ctx: 64_000 },
  { re: /16k/i, ctx: 16_000 },
  { re: /8k/i, ctx: 8_000 },
  { re: /4k/i, ctx: 4_000 },
]

function contextOf(model: string): number {
  for (const h of CONTEXT_HINTS) if (h.re.test(model)) return h.ctx
  return 8_000
}

const FREE_FILTER = /:free|^free\/|free-tier|llama.*free|claude.*free|gpt-4o-mini|gpt-4\.1-mini|mistral-(large|small|7b)|llama-3\.1-(70b|8b)|qwen-?(coder|2\.5)|deepseek|grok-?(beta|vision|mini|2)|gemini-1\.5-(flash|pro)|mixtral|codellama|starcoder|gemma-?2|phi-?3/i

/**
 * True if the model id looks like a free-tier or known-low-cost offering.
 * Pass the provider name too — keyless gateways (opencode, omniroute)
 * expose every model as free regardless of name.
 */
export function looksFree(model: string, provider?: string): boolean {
  if (provider && (provider === "opencode" || provider === "omniroute")) return true
  return FREE_FILTER.test(model)
}

/**
 * Curated OpenRouter free models (Sep 2026). These are the IDs that
 * OpenRouter serves at $0/M tokens right now. The list is intentionally
 * short — the discover step still goes through /models for any new free
 * IDs the provider adds, but this list gives the suggestTop3 algorithm a
 * quality boost (so a "free" model with a strong architecture outranks a
 * "free" model we don't know about).
 */
const OPENROUTER_FREE_CURATED: ReadonlyArray<{ re: RegExp; score: number }> = [
  { re: /^minimax\/minimax-m3:free$/i, score: 0.9 },
  { re: /^minimax\/minimax-m2\.7:free$/i, score: 0.88 },
  { re: /^google\/gemma-4-26b-a4b-it:free$/i, score: 0.85 },
  { re: /^google\/gemma-4-31b-it:free$/i, score: 0.85 },
  { re: /^nvidia\/nemotron-3-super-120b-a12b:free$/i, score: 0.95 },
  { re: /^nvidia\/nemotron-3-ultra-550b-a55b:free$/i, score: 0.95 },
  { re: /^z-ai\/glm-5\.2:free$/i, score: 0.85 },
  { re: /^cohere\/north-mini-code:free$/i, score: 0.82 },
  { re: /^meta-llama\/llama-3\.1-8b-instruct:free$/i, score: 0.78 },
  { re: /^meta-llama\/llama-3\.3-70b-instruct:free$/i, score: 0.9 },
  { re: /^qwen\/qwen-2\.5-72b-instruct:free$/i, score: 0.9 },
  { re: /^deepseek\/deepseek-v3(?:\.2|-chat):free$/i, score: 0.92 },
  { re: /^mistralai\/mistral-(?:small|7b):free$/i, score: 0.8 },
  { re: /^openchat\/openchat-3\.6:free$/i, score: 0.7 },
  { re: /^nousresearch\/hermes-3-llama-3\.1-70b:free$/i, score: 0.88 },
  { re: /^cognitivecomputations\/dolphin-3\.0-mistral-24b:free$/i, score: 0.78 },
]

/** Boost score for known strong free models on OpenRouter. */
function curatedOpenRouterBoost(model: string): number {
  for (const h of OPENROUTER_FREE_CURATED) if (h.re.test(model)) return h.score
  return 0
}

interface ProviderSlot {
  name: string
  baseUrl: string
  source: "keyless" | "farm"
  /** API key if available (undefined for keyless gateways). */
  apiKey?: string
}

/** Built-in keyless gateways. No API key required, served as fallback / first-choice.
 *  OpenCode is the primary free gateway (slow but always-on).
 *  OmniRoute is the local script-server on :20128 — silently skipped when not running. */
const KEYLESS_PROVIDERS: ProviderSlot[] = [
  { name: "opencode", baseUrl: "https://opencode.ai/zen/v1", source: "keyless" },
  { name: "omniroute", baseUrl: "http://127.0.0.1:20128/v1", source: "keyless" },
]

interface VaultShape {
  providers?: Record<string, Array<{ key: string; status?: string; source?: string }>>
}

/** Read the on-disk vault and return active farm keys grouped by provider. */
export function readVaultKeys(vaultPath?: string): ProviderSlot[] {
  const vp = vaultPath ?? path.join(os.homedir(), ".nexus", "api-vault.json")
  let raw: VaultShape = {}
  try {
    if (!fs.existsSync(vp)) return []
    raw = JSON.parse(fs.readFileSync(vp, "utf8")) as VaultShape
  } catch {
    return []
  }
  const out: ProviderSlot[] = []
  for (const [name, list] of Object.entries(raw.providers ?? {})) {
    for (const entry of list ?? []) {
      if (entry.status !== "active") continue
      // We only need one key per provider for the health probe.
      if (out.find((p) => p.name === name)) continue
      out.push({ name, baseUrl: inferBaseUrl(name), source: "farm", apiKey: entry.key })
    }
  }
  return out
}

function inferBaseUrl(name: string): string {
  // Best-effort mapping for the providers the autofarm plugin uses.
  // If we don't know the URL, the probe will simply fail and we drop the provider.
  const map: Record<string, string> = {
    openrouter: "https://openrouter.ai/api/v1",
    groq: "https://api.groq.com/openai/v1",
    cerebras: "https://api.cerebras.ai/v1",
    mistral: "https://api.mistral.ai/v1",
    cohere: "https://api.cohere.com/v1",
    fireworks_ai: "https://api.fireworks.ai/inference/v1",
    together_ai: "https://api.together.xyz/v1",
    deepseek: "https://api.deepseek.com/v1",
    huggingface: "https://api-inference.huggingface.co/models",
    perplexity: "https://api.perplexity.ai",
    xai: "https://api.x.ai/v1",
    replicate: "https://api.replicate.com/v1",
  }
  return map[name] ?? ""
}

interface PingResult {
  ok: boolean
  latencyMs: number
  models: string[]
}

/** Live-ping a provider at /models. Returns latency + model list. */
async function pingProvider(p: ProviderSlot, timeoutMs: number): Promise<PingResult> {
  if (!p.baseUrl) return { ok: false, latencyMs: 0, models: [] }
  const t0 = Date.now()
  try {
    const ctl = new AbortController()
    const tid = setTimeout(() => ctl.abort(), timeoutMs)
    const headers: Record<string, string> = {}
    if (p.apiKey) headers["authorization"] = `Bearer ${p.apiKey}`
    const res = await fetch(p.baseUrl.replace(/\/$/, "") + "/models", { signal: ctl.signal, headers })
    clearTimeout(tid)
    const latencyMs = Date.now() - t0
    if (!res.ok) return { ok: false, latencyMs, models: [] }
    const j = (await res.json()) as { data?: Array<{ id: string }> }
    const models = (j.data ?? []).map((m) => m.id)
    return { ok: models.length > 0, latencyMs, models }
  } catch {
    return { ok: false, latencyMs: 0, models: [] }
  }
}

/** Health-probe a provider with a real chat-completions call. */
async function probeProvider(p: ProviderSlot, model: string, timeoutMs: number): Promise<{ ok: boolean; error?: string }> {
  if (p.source === "keyless") {
    // Keyless gateways are validated by the /models ping alone.
    return { ok: true }
  }
  if (!p.apiKey) return { ok: false, error: "no-api-key" }
  try {
    const ctl = new AbortController()
    const tid = setTimeout(() => ctl.abort(), timeoutMs)
    const res = await fetch(p.baseUrl.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${p.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
    })
    clearTimeout(tid)
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      // 4xx with a billing/quota error = the model is paid or rate-limited; drop it.
      if (res.status === 401 || res.status === 402 || res.status === 403) {
        return { ok: false, error: `auth/billing (${res.status})` }
      }
      return { ok: false, error: `http ${res.status}: ${text.slice(0, 80)}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Suggest the top N best free, fast, currently-available models. */
export async function suggestTop3(opts: Top3Options = {}): Promise<Top3Candidate[]> {
  const topN = opts.topN ?? 3
  const defaultTimeout = opts.timeoutMs ?? 6000
  // Keyless gateways (opencode) are slow but free, give them a longer
  // window. Farm providers have proper keys so they should be quick.
  const timeoutFor = (p: ProviderSlot) =>
    p.source === "keyless" ? Math.max(defaultTimeout, 15_000) : defaultTimeout

  // 1. Collect providers: keyless first, then vault farm keys.
  const providers: ProviderSlot[] = [...KEYLESS_PROVIDERS, ...readVaultKeys(opts.vaultPath)]

  // 2. Live ping. Split into two groups: keyless (slow, sequential) and
  //    farm (parallel with short timeout). This way the opencode gateway
  //    doesn't block the whole list — the OpenRouter farm ping results
  //    are visible after a few seconds while opencode is still being
  //    probed in the background.
  const keyless = providers.filter((p) => p.source === "keyless")
  const farm = providers.filter((p) => p.source !== "keyless")

  // Free-tier endpoints (opencode, OpenRouter free) often take 5-12s on
  // cold start; default to 15s for both groups so we don't drop them on a
  // slow day. Callers can still override with opts.timeoutMs for the
  // legacy short-window behavior.
  const keylessTimeout = Math.max(15_000, defaultTimeout)
  const farmTimeout = Math.max(15_000, defaultTimeout)

  const [farmLive, keylessLive] = await Promise.all([
    Promise.all(farm.map(async (p) => ({ p, ping: await pingProvider(p, farmTimeout) }))),
    Promise.all(keyless.map(async (p) => ({ p, ping: await pingProvider(p, keylessTimeout) }))),
  ])
  const live = [...farmLive, ...keylessLive]

  // 3. Build candidate list. For each live provider, take only free-looking models.
  const out: Top3Candidate[] = []
  for (const { p, ping } of live) {
    if (!ping.ok) continue
    for (const m of ping.models) {
      if (!looksFree(m, p.name)) continue
      const q = qualityOf(m)
      // Boost known-strong free models on OpenRouter (curated Sep 2026 list).
      const curated = p.name === "openrouter" ? curatedOpenRouterBoost(m) : 0
      // Latency sweet-spot: 0ms -> 1.0, 1500ms -> 0.5, 5000ms+ -> 0.0
      // (was /2000, which made anything > 2s indistinguishable from 0).
      const speed = ping.latencyMs > 0 ? Math.max(0, 1 - ping.latencyMs / 5000) : 0.5
      // Curated score replaces quality when present, otherwise standard heuristic.
      const effectiveQuality = curated > 0 ? curated : q
      const score = speed * 0.4 + effectiveQuality * 0.4 + 0.2
      out.push({
        provider: p.name,
        model: m,
        score,
        latencyMs: ping.latencyMs,
        context: contextOf(m),
        source: p.source,
        probed: "skipped",
      })
    }
  }

  // 4. Sort by score and keep a slightly larger slice so probe failures still leave us with topN.
  out.sort((a, b) => b.score - a.score)
  const top = out.slice(0, Math.max(topN, 5))

  // 5. Health-probe the top candidates with a real API call (skipped for keyless).
  if (!opts.skipProbe) {
    await Promise.all(
      top.map(async (c) => {
        const slot = providers.find((p) => p.name === c.provider)
        if (!slot) return
        const r = await probeProvider(slot, c.model, timeoutMs)
        c.probed = r.ok ? "ok" : "skipped"
        if (!r.ok) c.error = r.error
      }),
    )
  }

  // 6. Drop probed=fail. Keep "ok" and "skipped" so a transient probe failure
  //    doesn't wipe out a perfectly valid candidate.
  return top
    .filter((c) => c.probed !== "skipped" || !c.error)
    .slice(0, topN)
}

/** Human-readable one-line summary for a candidate. */
export function describe(c: Top3Candidate): string {
  const tag = c.probed === "ok" ? "OK" : "?"
  return `${tag} ${c.provider}/${c.model}  ctx=${(c.context / 1000).toFixed(0)}k  ~${c.latencyMs}ms  score=${(c.score * 100).toFixed(0)}  [${c.source}]`
}
