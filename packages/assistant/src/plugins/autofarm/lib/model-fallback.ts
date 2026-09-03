// model-fallback: multi-agent parallel dispatcher with smart
// token-quota rotation across OpenRouter free models.
//
// User requirement: "multi agents ko lagao, token khatam ho jaye
// toh agent ko bol ke aur daal lena API". The translation:
//
//   1. A user task can be split into 2-3 sub-agents that run in
//      parallel (research / code / test). They share the
//      OpenRouter free quota pool.
//   2. Each sub-agent uses a different free model, so a quota
//      limit on one does not block the others.
//   3. When a model returns 429 (rate-limited) or a 4xx, we
//      rotate to the next free model in the curated list — no
//      user prompt, no manual swap.
//   4. Quota usage is tracked in-memory and persisted to
//      ~/.nexus/autofarm/quota.json so we never re-pick a model
//      that just exhausted its daily window.
//
// The free models list mirrors the curated list in
// packages/tui/src/util/top3-models.ts so the picker and the
// fallback agree on which OpenRouter IDs are currently $0.

import fs from "node:fs"
import path from "node:path"
import os from "node:os"

const QUOTA_PATH = path.join(os.homedir(), ".nexus", "autofarm", "quota.json")

/** A free OpenRouter model that can serve as a primary or
 *  fallback. We do NOT include paid models here — the whole
 *  point of this module is the free tier. */
export interface FreeModel {
  /** OpenRouter ID, slash-separated provider/model. */
  id: string
  /** Friendly label. */
  label: string
  /** Approximate requests-per-day that the model can serve on
   *  the free tier. 0 means 'unknown, retry on failure'. */
  dailyBudget: number
}

export const FREE_MODELS: ReadonlyArray<FreeModel> = [
  { id: "minimax/minimax-m3:free", label: "MiniMax M3 (free)", dailyBudget: 200 },
  { id: "minimax/minimax-m2.7:free", label: "MiniMax M2.7 (free)", dailyBudget: 200 },
  { id: "google/gemma-4-26b-a4b-it:free", label: "Google Gemma 4 26B (free)", dailyBudget: 150 },
  { id: "nvidia/nemotron-3-super-120b-a12b:free", label: "NVIDIA Nemotron 3 Super 120B (free)", dailyBudget: 100 },
  { id: "z-ai/glm-5.2:free", label: "Z.AI GLM 5.2 (free)", dailyBudget: 150 },
  { id: "cohere/north-mini-code:free", label: "Cohere North Mini Code (free)", dailyBudget: 100 },
  { id: "meta-llama/llama-3.1-8b-instruct:free", label: "Meta Llama 3.1 8B (free)", dailyBudget: 200 },
  { id: "qwen/qwen-2.5-72b-instruct:free", label: "Qwen 2.5 72B (free)", dailyBudget: 100 },
  { id: "mistralai/mistral-small:free", label: "Mistral Small (free)", dailyBudget: 150 },
]

interface QuotaState {
  /** YYYY-MM-DD */
  day: string
  /** Per-model requests used today. */
  used: Record<string, number>
  /** Per-model last 429 timestamp. */
  last429: Record<string, number>
}

function emptyState(): QuotaState {
  return { day: new Date().toISOString().slice(0, 10), used: {}, last429: {} }
}

function loadQuota(): QuotaState {
  try {
    if (!fs.existsSync(QUOTA_PATH)) return emptyState()
    const raw = JSON.parse(fs.readFileSync(QUOTA_PATH, "utf8")) as QuotaState
    // Reset on day rollover.
    const today = new Date().toISOString().slice(0, 10)
    if (raw.day !== today) return emptyState()
    return raw
  } catch {
    return emptyState()
  }
}

function saveQuota(s: QuotaState): void {
  try {
    fs.mkdirSync(path.dirname(QUOTA_PATH), { recursive: true })
    fs.writeFileSync(QUOTA_PATH, JSON.stringify(s, null, 2))
  } catch {
    // best-effort
  }
}

/** Pick the best free model for the next request, skipping any
 *  that has hit its daily budget or got a 429 in the last
 *  10 minutes. Round-robins through the remaining pool. */
export function pickFreeModel(state = loadQuota()): FreeModel | undefined {
  const usable = FREE_MODELS.filter((m) => {
    const used = state.used[m.id] ?? 0
    if (used >= m.dailyBudget) return false
    const last = state.last429[m.id] ?? 0
    if (Date.now() - last < 10 * 60_000) return false
    return true
  })
  if (usable.length === 0) return undefined
  // Pick the one with the lowest current usage so we spread load.
  usable.sort((a, b) => (state.used[a.id] ?? 0) - (state.used[b.id] ?? 0))
  return usable[0]
}

/** Record that we used this model. */
export function recordUse(modelId: string): void {
  const s = loadQuota()
  s.used[modelId] = (s.used[modelId] ?? 0) + 1
  saveQuota(s)
}

/** Record a 429 so the picker can back off for 10 minutes. */
export function recordRateLimit(modelId: string): void {
  const s = loadQuota()
  s.last429[modelId] = Date.now()
  saveQuota(s)
}

/** Human-readable usage snapshot. */
export function quotaReport(): string {
  const s = loadQuota()
  const lines: string[] = []
  lines.push(`Free-model quota — ${s.day}`)
  for (const m of FREE_MODELS) {
    const used = s.used[m.id] ?? 0
    const last = s.last429[m.id] ?? 0
    const cooldownMin = last > 0 ? Math.max(0, Math.ceil((600_000 - (Date.now() - last)) / 60000)) : 0
    const status = used >= m.dailyBudget ? "exhausted" : cooldownMin > 0 ? `cooldown ${cooldownMin}m` : "ok"
    lines.push(`  [${status.padEnd(10)}] ${m.id.padEnd(50)} ${used}/${m.dailyBudget}`)
  }
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Multi-agent parallel dispatcher.
//
// Given a list of named sub-tasks, run them in parallel. Each sub-task
// is invoked with a free-model handle. If the model call fails, the
// dispatcher rotates to the next free model automatically. Sub-tasks
// are independent — they do not share state — so Promise.all is safe.

export interface SubTask {
  name: string
  /** Async function. The dispatcher supplies the picked model id
   *  and an OpenRouter key from the vault. */
  run: (ctx: { model: FreeModel; apiKey: string; signal: AbortSignal }) => Promise<unknown>
}

export interface DispatchResult {
  name: string
  ok: boolean
  model: string
  attempts: number
  output: unknown
  error?: string
}

export interface DispatchOptions {
  /** Stop the entire batch as soon as one task fails. Default false. */
  failFast?: boolean
  /** Max retries per task across the free-model pool. Default 3. */
  maxRetries?: number
  /** Per-attempt timeout in ms. Default 30_000. */
  timeoutMs?: number
}

/** Resolve an OpenRouter key from ~/.nexus/api-vault.json with
 *  ROUND-ROBIN rotation across every active key. The first call
 *  returns key 0, the second key 1, etc. When a key returns 429,
 *  the dispatcher calls recordKeyRateLimit() so the picker
 *  skips it for 5 minutes (or 1 hour after 3+ failures). This
 *  prevents the burn-through-quota failure mode where one key
 *  takes 1314 requests / day and the other 4 sit idle. */
export function pickVaultKey(vaultPath?: string): string | undefined {
  // Lazy import to avoid a circular dep at module-load time
  // (vault-summary.ts reads the same file).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("./vault-key-rotation.ts") as typeof import("./vault-key-rotation.ts")
  return mod.pickNextKey(vaultPath)
}

export function recordKeyRateLimit(key: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("./vault-key-rotation.ts") as typeof import("./vault-key-rotation.ts")
  mod.recordKeyRateLimit(key)
}

export function recordKeySuccess(key: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("./vault-key-rotation.ts") as typeof import("./vault-key-rotation.ts")
  mod.recordKeySuccess(key)
}

export async function dispatch(
  tasks: SubTask[],
  opts: DispatchOptions = {},
): Promise<DispatchResult[]> {
  const maxRetries = opts.maxRetries ?? 3
  const timeoutMs = opts.timeoutMs ?? 30_000
  const apiKey = pickVaultKey()
  if (!apiKey) {
    return tasks.map((t) => ({
      name: t.name,
      ok: false,
      model: "none",
      attempts: 0,
      output: undefined,
      error: "no active OpenRouter key in ~/.nexus/api-vault.json",
    }))
  }

  const ac = new AbortController()
  const wrap = async (task: SubTask): Promise<DispatchResult> => {
    let lastErr: string | undefined
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const model = pickFreeModel()
      if (!model) {
        return { name: task.name, ok: false, model: "exhausted", attempts: attempt, output: undefined, error: "all free models exhausted for the day" }
      }
      recordUse(model.id)
      const tid = setTimeout(() => ac.abort(), timeoutMs)
      try {
        const out = await task.run({ model, apiKey, signal: ac.signal })
        clearTimeout(tid)
        if (opts.failFast) ac.abort()
        return { name: task.name, ok: true, model: model.id, attempts: attempt + 1, output: out }
      } catch (e) {
        clearTimeout(tid)
        lastErr = (e as Error).message
        // Coarse-grained rate-limit detection: any 4xx in the
        // message is treated as a quota/rate-limit signal.
        if (/429|rate.?limit|too many|exhausted/i.test(lastErr)) {
          recordRateLimit(model.id)
        }
        // Try the next free model on the next iteration.
      }
    }
    return { name: task.name, ok: false, model: "rotated-out", attempts: maxRetries, output: undefined, error: lastErr }
  }
  return Promise.all(tasks.map(wrap))
}
