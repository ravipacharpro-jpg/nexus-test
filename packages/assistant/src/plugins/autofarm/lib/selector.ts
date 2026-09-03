// Upgrade 4: Task-aware key selection
// Each provider key gets a "task profile" score (1..10) for
//   - chat (fast chat models)
//   - code (code completion / strong reasoning)
//   - vision (multimodal)
//   - long-context
//   - embed
//
// The selector picks the best key for a given task class.

import { loadVault } from "./vault.ts"

export type TaskClass = "chat" | "code" | "vision" | "long-context" | "embed" | "any"

export interface ProviderScore {
  provider: string
  taskScore: number
  reasons: string[]
}

/** Hand-curated task scores. 0 = not suited. */
const TASK_PROFILES: Record<string, Record<TaskClass, number>> = {
  groq:       { chat: 10, code: 8, vision: 0, "long-context": 6, embed: 0, any: 9 },
  cerebras:   { chat: 8, code: 10, vision: 0, "long-context": 5, embed: 0, any: 9 },
  openrouter: { chat: 9, code: 9, vision: 8, "long-context": 9, embed: 0, any: 9 },
  together_ai:{ chat: 7, code: 7, vision: 6, "long-context": 7, embed: 0, any: 7 },
  fireworks_ai:{ chat: 8, code: 8, vision: 5, "long-context": 6, embed: 0, any: 8 },
  mistral:    { chat: 8, code: 8, vision: 4, "long-context": 8, embed: 0, any: 8 },
  anthropic:  { chat: 9, code: 9, vision: 7, "long-context": 10, embed: 0, any: 9 },
  xai:        { chat: 8, code: 7, vision: 5, "long-context": 6, embed: 0, any: 7 },
  cohere:     { chat: 7, code: 6, vision: 0, "long-context": 8, embed: 0, any: 7 },
  perplexity: { chat: 9, code: 5, vision: 0, "long-context": 7, embed: 0, any: 8 },
  replicate:  { chat: 5, code: 5, vision: 9, "long-context": 4, embed: 0, any: 5 },
  huggingface:{ chat: 6, code: 6, vision: 7, "long-context": 6, embed: 9, any: 6 },
  deepseek:   { chat: 7, code: 10, vision: 0, "long-context": 8, embed: 0, any: 8 },
}

/** Score a single provider for a given task. */
export function scoreProvider(provider: string, task: TaskClass): ProviderScore {
  const profile = TASK_PROFILES[provider] ?? { chat: 5, code: 5, vision: 5, "long-context": 5, embed: 5, any: 5 }
  const score = task === "any" ? profile.any : profile[task]
  const reasons: string[] = []
  if (task !== "any") {
    if (score >= 9) reasons.push(`best-in-class for ${task}`)
    else if (score >= 7) reasons.push(`strong ${task}`)
    else if (score >= 5) reasons.push(`usable for ${task}`)
    else if (score === 0) reasons.push(`not suited for ${task}`)
  }
  return { provider, taskScore: score, reasons }
}

/**
 * Pick the best key for a task from the vault.
 * Filters out invalid / suspended / cooldown keys and
 * sorts the remaining by task score.
 */
export function pickKeyForTask(task: TaskClass): { provider: string; key: string } | null {
  const vault = loadVault()
  const now = Date.now()
  const candidates: { provider: string; key: string; score: number }[] = []
  for (const [provider, entries] of Object.entries(vault.providers)) {
    const score = scoreProvider(provider, task).taskScore
    for (const entry of entries) {
      if (entry.status === "invalid") continue
      if (entry.status === "suspended" && entry.suspendedUntil && Date.parse(entry.suspendedUntil) > now) continue
      if (entry.cooldownUntil && Date.parse(entry.cooldownUntil) > now) continue
      candidates.push({ provider, key: entry.key, score })
    }
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.score - a.score)
  return { provider: candidates[0].provider, key: candidates[0].key }
}

/** Top N providers for a given task class, sorted by score. */
export function topProvidersForTask(task: TaskClass, n = 5): ProviderScore[] {
  return Object.keys(TASK_PROFILES)
    .map((p) => scoreProvider(p, task))
    .sort((a, b) => b.taskScore - a.taskScore)
    .slice(0, n)
}
