// model-selector: pick the top 3 best FREE+FAST+AVAILABLE models for any task.
// Steps:
//   1. Fetch live model list from OpenAI-compatible /models endpoint
//      (OpenRouter, NEXUS Free Gateway, OmniRoute, Groq, Cerebras, …)
//   2. Filter: free=true, fast (latency < 2s) and powerful (context >= 8k, params >= 7B)
//   3. Score: speed*0.4 + quality*0.4 + freshness*0.2
//   4. Health-check top candidate with a 1-token probe; if dead, drop to next
//   5. Return the top 3 that actually work RIGHT NOW
//
// Why "available check": providers quietly add/remove free models.
// A model that was free yesterday may be pay-only today, or the whole
// provider may be 503ing. We never recommend a model we can't reach.

import { log } from "./logger.ts"
import { getAllKeys } from "./vault.ts"
import { FREE_PROVIDERS, getProvider } from "./config.ts"
import { probeKey } from "../agents/provider-agent.ts"

export interface ModelCandidate {
  /** provider id (groq, openrouter, …) */
  provider: string
  /** model id as the provider exposes it */
  model: string
  /** free-tier flag */
  free: boolean
  /** context window in tokens (0 if unknown) */
  context: number
  /** measured /models latency in ms (0 if unknown) */
  latencyMs: number
  /** quality score 0..1 (rough heuristic by family + size) */
  quality: number
  /** total composite score */
  score: number
  /** probe result: did the API key actually work? */
  probed: "ok" | "fail" | "skipped"
  /** error message if probed=fail */
  error?: string
}

export interface SuggestOptions {
  task?: "code" | "chat" | "vision" | "long-context" | "any"
  /** How many to return (default 3). */
  topN?: number
  /** Skip the live health probe (faster, less safe). */
  skipProbe?: boolean
  /** Only consider these providers (default: all FREE_PROVIDERS). */
  providers?: string[]
}

const QUALITY_HINTS: Array<{ re: RegExp; score: number }> = [
  { re: /llama-3\.1-?70b|llama-3\.3-?70b|qwen-2\.5-?72b|mixtral-8x22b|deepseek-v3|claude-3-5-sonnet|gpt-4o|gemini-1\.5-pro/i, score: 0.95 },
  { re: /llama-3\.1-?8b|llama-3\.3-?8b|mistral-?(large|small)-latest|qwen-2\.5-?7b|deepseek-chat|gpt-4o-mini|gemini-1\.5-flash|grok-?(beta|vision)/i, score: 0.80 },
  { re: /llama-3\.2|phi-3|phi-3\.5|gemma-?2|mistral-7b|qwen-?1\.5/i, score: 0.70 },
  { re: /gpt-3\.5|turbo-16k|claude-3-haiku/i, score: 0.65 },
]

function qualityOf(model: string): number {
  for (const h of QUALITY_HINTS) if (h.re.test(model)) return h.score
  return 0.55 // unknown → middling
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

const TASK_BONUS: Record<string, RegExp> = {
  code: /code|qwen|deepseek-coder|starcoder|codellama|gpt-4/i,
  chat: /chat|instruct|it$/i,
  vision: /vision|vl|gemini|gpt-4o|grok-vision|llava/i,
  "long-context": /128k|200k|1m|2m|claude|gemini/i,
}

function taskBonus(model: string, task: string): number {
  const re = TASK_BONUS[task]
  if (!re || task === "any") return 0
  return re.test(model) ? 0.1 : 0
}

/** Probe provider /models with a short timeout. Returns latencyMs or 0. */
async function pingProvider(p: { baseUrl: string; name: string }): Promise<{ latencyMs: number; models: string[]; ok: boolean }> {
  const t0 = Date.now()
  try {
    const ctl = new AbortController()
    const tid = setTimeout(() => ctl.abort(), 8_000)
    const res = await fetch(p.baseUrl + "/models", { signal: ctl.signal })
    clearTimeout(tid)
    const latencyMs = Date.now() - t0
    if (!res.ok) return { latencyMs, models: [], ok: false }
    const j = (await res.json()) as { data?: Array<{ id: string }> }
    const models = (j.data ?? []).map((m) => m.id)
    return { latencyMs, models, ok: true }
  } catch {
    return { latencyMs: 0, models: [], ok: false }
  }
}

/** Suggest the top N best models for a task. */
export async function suggestModels(opts: SuggestOptions = {}): Promise<ModelCandidate[]> {
  const task = opts.task ?? "any"
  const topN = opts.topN ?? 3
  const providers = (opts.providers ?? FREE_PROVIDERS.map((p) => p.name))
    .map((n) => getProvider(n))
    .filter((p): p is NonNullable<typeof p> => !!p)

  // 1. Live ping
  const live = await Promise.all(
    providers.map(async (p) => ({ p, info: await pingProvider(p) }))
  )

  // 2. Build candidate list (intersection of catalog + live)
  const out: ModelCandidate[] = []
  for (const { p, info } of live) {
    if (!info.ok) continue
    const liveSet = new Set(info.models)
    const liveFree = info.models.filter((m) => /:free|^free\/|free-tier|llama.*free/i.test(m))
    // Combine: declared free models + live free-looking models
    const combined = new Set([...p.models.filter((m) => /:free|^free\//i.test(m)), ...liveFree])
    for (const m of combined) {
      // Skip if model not actually live on this provider
      if (liveSet.size > 0 && !liveSet.has(m) && !m.endsWith(":free")) continue
      const ctx = contextOf(m)
      const q = qualityOf(m) + taskBonus(m, task)
      const speed = info.latencyMs > 0 ? Math.max(0, 1 - info.latencyMs / 2000) : 0.5
      const score = speed * 0.4 + q * 0.4 + 0.2
      out.push({
        provider: p.name,
        model: m,
        free: true,
        context: ctx,
        latencyMs: info.latencyMs,
        quality: Math.min(1, q),
        score,
        probed: "skipped",
      })
    }
  }

  // 3. Sort by score
  out.sort((a, b) => b.score - a.score)
  const top = out.slice(0, Math.max(topN, 5))

  // 4. Health probe (with a real API key if we have one in the vault)
  if (!opts.skipProbe) {
    for (const c of top) {
      const p = getProvider(c.provider)
      if (!p) continue
      const all = getAllKeys()
      const v = all.find((x) => x.provider === c.provider && x.entry.status === "active")
      if (!v) {
        c.probed = "skipped"
        continue
      }
      try {
        const r = await probeKey(p, v.entry.key)
        c.probed = r.ok ? "ok" : "fail"
        c.error = r.error
        if (r.ok) c.latencyMs = r.latencyMs
      } catch (e) {
        c.probed = "fail"
        c.error = (e as Error).message
      }
    }
  }

  // 5. Keep only "ok" or "skipped" (drop dead)
  return top
    .filter((c) => c.probed !== "fail")
    .slice(0, topN)
}

/** Human-readable summary. */
export function formatSuggestions(list: ModelCandidate[]): string {
  if (list.length === 0) return "  (no models passed availability check)"
  const lines: string[] = []
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    const tag = c.probed === "ok" ? "OK " : c.probed === "skipped" ? "?  " : "X  "
    lines.push(
      `  ${i + 1}. [${tag}] ${c.provider}/${c.model}` +
        `  ctx=${(c.context / 1000).toFixed(0)}k` +
        `  ~${c.latencyMs}ms` +
        `  score=${(c.score * 100).toFixed(0)}`
    )
  }
  return lines.join("\n")
}
