export type RotatingKeys = Record<string, string[] | undefined>

import { getCachedKeyStatus } from "../api/ApiVault"

/**
 * Selects configured credentials in a deterministic round-robin order.
 * The engine is intentionally in-memory; secrets remain in NEXUS config/auth storage.
 */
export class RotationEngine {
  private readonly positions = new Map<string, number>()
  private readonly selectedKeys = new Map<string, string>()

  constructor(
    private readonly keys: RotatingKeys = {},
    private readonly enabled = true,
  ) {}

  next(providerID: string): string | undefined {
    if (!this.enabled) return undefined
    const allValues = keyValues(this.keys, providerID).filter(
      (value) => typeof value === "string" && value.trim().length > 0,
    )
    if (allValues.length === 0) return undefined

    const now = Date.now()
    const eligibleValues = allValues.filter((value) => {
      const status = getCachedKeyStatus(value)
      if (!status) return true
      if (status.status === "invalid") return false
      if (status.status === "suspended") {
        return Boolean(status.suspendedUntil && Date.parse(status.suspendedUntil) <= now)
      }
      if (status.cooldownUntil && Date.parse(status.cooldownUntil) > now) return false
      return true
    })

    if (eligibleValues.length === 0) return undefined

    const position = this.positions.get(providerID) ?? 0

    // Rotate deterministically over the eligible set. The cursor is indexed into
    // `eligibleValues` (not the full key list) so changes in the eligible set
    // between calls can no longer skip or reuse keys.
    for (let attempts = 0; attempts < eligibleValues.length; attempts++) {
      const index = (position + attempts) % eligibleValues.length
      const value = eligibleValues[index]
      const status = getCachedKeyStatus(value)
      // Skip keys that entered a cooldown since the eligible snapshot was taken.
      if (status?.cooldownUntil && Date.parse(status.cooldownUntil) > now) continue
      this.positions.set(providerID, (index + 1) % eligibleValues.length)
      this.selectedKeys.set(providerID, value)
      return value
    }

    return undefined
  }

  current(providerID: string): string | undefined {
    if (!this.enabled) return undefined
    return this.selectedKeys.get(providerID)
  }

  has(providerID: string): boolean {
    return this.keyCount(providerID) > 0
  }

  /** Number of keys that can still participate in the current rotation cycle. */
  keyCount(providerID: string): number {
    if (!this.enabled) return 0
    const now = Date.now()
    return keyValues(this.keys, providerID).filter((value) => {
      if (typeof value !== "string" || value.trim().length === 0) return false
      const status = getCachedKeyStatus(value)
      if (!status || status.status === "active" || status.status === "unknown") return true
      if (status.status === "rate_limited") return !status.cooldownUntil || Date.parse(status.cooldownUntil) <= now
      return status.status === "suspended" && Boolean(status.suspendedUntil && Date.parse(status.suspendedUntil) <= now)
    }).length
  }

  static isRateLimited(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return /rate.?limit|too many requests|quota exceeded|freeusagelimit|(?:status|http|error)?\s*[:(]?\s*429\b/i.test(
      message,
    )
  }

  /** Provider failures that should advance to another configured engine. */
  static isFallbackable(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return /rate.?limit|too many requests|quota exceeded|freeusagelimit|(?:model|resource).*(?:not found|does not exist|do not have access|unavailable)|(?:not found|does not exist|unavailable).*(?:model|resource)|model is unavailable|unavailable|overloaded|capacity|temporarily unavailable|extra_content|tool_calls.*extra|invalid[_ -]?api[_ -]?key|api[_ -]?key.*(?:invalid|not valid)|(?:invalid|missing).*(?:authentication|credentials)|unauthorized|forbidden|missing authentication header|(?:status|http|error)?\s*[:(]?\s*(?:401|403|404|429|529|503)\b|unexpected server error|failed to fetch/i.test(
      message,
    )
  }
}

export const PROVIDER_FALLBACK_ORDER = [
  "groq",
  "openrouter",
  "cloudflare-workers-ai",
  "nvidia-nim",
  "google",
  "ollama",
  "opencode",
  "openai",
  "anthropic",
  "xai",
  "mistral",
  "deepseek",
  "cerebras",
  "togetherai",
  "fireworks",
  "moonshotai",
  "cohere",
  "perplexity",
] as const

/** Canonical low-cost/free model order used by setup, default selection, and model tests. */
export const PREFERRED_MODELS = {
  groq: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.6-27b"],
  openrouter: [
    "meta-llama/llama-3.1-8b-instruct:free",
    "google/gemma-2b-it:free",
    "mistralai/mistral-7b-instruct:free",
    "nousresearch/hermes-3-llama-3.1-405b:free",
  ],
  // Use current text-generation models only. Never use TTS/image/audio models here.
  google: ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  cerebras: ["llama3.3-70b", "llama3.1-8b"],
  opencode: ["grok-code-fast-1"],
  openai: ["gpt-4o-mini", "gpt-4.1-mini"],
  anthropic: ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-3-5-haiku-latest"],
  xai: ["grok-4", "grok-code-fast-1", "grok-3-mini"],
  mistral: ["mistral-large-latest", "mistral-small-latest"],
  togetherai: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-72B-Instruct-Turbo"],
  perplexity: ["sonar-pro", "sonar"],
  cohere: ["command-a-03-2025", "command-r-plus-08-2024"],
  fireworks: ["accounts/fireworks/models/llama-v3p3-70b-instruct"],
  moonshotai: ["kimi-k2-0711-preview", "moonshot-v1-8k"],
  "cloudflare-workers-ai": [
    "@cf/meta/llama-3.1-8b-instruct",
    "@cf/qwen/qwen2.5-coder-32b-instruct",
    "@cf/meta/llama-3.2-11b-vision-instruct",
    "@cf/qwen/qwq-32b",
  ],
  "nvidia-nim": [
    "meta/llama-3.3-70b-instruct",
    "qwen/qwen2.5-coder-32b-instruct",
    "nvidia/nemotron-3.5-lightning-30b-a3b",
    "qwen/qwen3-next-80b-a3b-thinking",
  ],
} as const

export type PreferredProvider = keyof typeof PREFERRED_MODELS

export function isTextGenerationCandidate(providerID: string, id: string, model: unknown): boolean {
  const lower = id.toLowerCase()
  // These model families do not implement the text chat request used by
  // `nexus models test`. In particular, a broad /gemini/ fallback can select
  // Gemini TTS, image, or native-audio previews when the catalog is partial.
  if (
    /(?:tts|native-audio|audio|image|video|embedding|embed|speech|lyria|music|deep-research|computer-use|robotics|banana)/i.test(
      lower,
    )
  ) {
    return false
  }
  if (!model || typeof model !== "object") return true
  const value = model as {
    capabilities?: { input?: { text?: boolean }; output?: { text?: boolean } }
    modalities?: { input?: unknown[]; output?: unknown[] }
  }
  if (value.capabilities?.output?.text === false) return false
  if (Array.isArray(value.modalities?.output) && !value.modalities.output.includes("text")) return false
  if (value.capabilities?.input?.text === false) return false
  if (Array.isArray(value.modalities?.input) && !value.modalities.input.includes("text")) return false
  return true
}

export function preferredModelForProvider(providerID: string, models: Record<string, unknown>): string | undefined {
  const preferred = PREFERRED_MODELS[providerID as PreferredProvider]
  if (!preferred) return undefined
  const catalogKeys = Object.keys(models)
  for (const id of preferred) {
    if (models[id] !== undefined && isTextGenerationCandidate(providerID, id, models[id])) return id
    // Match provider aliases/versions only when the matched entry is also a
    // text-generation model. This prevents a partial match from selecting TTS.
    const partialMatch = catalogKeys.find(
      (k) =>
        isTextGenerationCandidate(providerID, k, models[k]) &&
        (id.startsWith(k) || k.startsWith(id) || k.includes(id.split(":")[0])),
    )
    if (partialMatch) return partialMatch
  }
  return undefined
}

export function providerPriority(providerID: string): number {
  const index = PROVIDER_FALLBACK_ORDER.indexOf(providerID as (typeof PROVIDER_FALLBACK_ORDER)[number])
  return index === -1 ? PROVIDER_FALLBACK_ORDER.length : index
}

export function isDeprecatedFreeProvider(providerID: string): boolean {
  return false // We want opencode to be available as a fallback
}

export function modelWarning(providerID: string): string | undefined {
  if (!isDeprecatedFreeProvider(providerID)) return undefined
  return "NEXUS gateway is rate-limited. Try OpenRouter free models: /top3 to see available options."
}

function keyValues(apiKeys: RotatingKeys, providerID: string): string[] {
  if (providerID === "google") return apiKeys.google ?? apiKeys.gemini ?? []
  if (providerID === "gemini") return apiKeys.gemini ?? apiKeys.google ?? []
  return apiKeys[providerID] ?? []
}

export function configuredProviderKeys(apiKeys: RotatingKeys | undefined, providerID: string): string[] {
  return keyValues(apiKeys ?? {}, providerID).filter((value) => value.trim().length > 0)
}

export function normalizeProviderKeyName(key: string): string | undefined {
  const normalized = key.trim().toUpperCase()
  if (!normalized.endsWith("_API_KEY")) return undefined
  const provider = normalized.slice(0, -"_API_KEY".length).toLowerCase().replace(/_/g, "-")
  const known = [
    "groq",
    "openrouter",
    "gemini",
    "google",
    "openai",
    "anthropic",
    "xai",
    "mistral",
    "deepseek",
    "cerebras",
    "togetherai",
    "perplexity",
    "cohere",
    "fireworks",
    "moonshotai",
    "cloudflare",
    "nvidia-nim",
  ]
  if (!known.includes(provider)) return undefined
  if (provider === "gemini") return "google"
  if (provider === "cloudflare") return "cloudflare-workers-ai"
  return provider
}

export function redactSecret(value: string): string {
  if (value.length <= 8) return "********"
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

export function providerFromEnvKey(key: string): string | undefined {
  return normalizeProviderKeyName(key)
}

export function isAgentCapableModel(model: unknown): boolean {
  if (!model || typeof model !== "object") return true
  const value = model as { status?: string; capabilities?: { toolcall?: boolean }; tool_call?: boolean }
  if (value.status === "deprecated") return false
  if (value.capabilities?.toolcall === false || value.tool_call === false) return false
  return true
}

export function modelForAgent(providerID: string, models: Record<string, unknown>): string | undefined {
  const candidates = Object.fromEntries(
    Object.entries(models).filter(
      ([id, model]) => isTextGenerationCandidate(providerID, id, model) && isAgentCapableModel(model),
    ),
  )
  return modelForProvider(providerID, candidates) ?? modelForProvider(providerID, models)
}

export function modelForProvider(providerID: string, models: Record<string, unknown>): string | undefined {
  const ids = Object.keys(models)
  const preferred = preferredModelForProvider(providerID, models)
  if (preferred) return preferred
  const textIds = ids.filter((id) => isTextGenerationCandidate(providerID, id, models[id]))
  if (providerID === "ollama") return textIds.find((id) => /qwen2\.5-coder|llama3|phi3/i.test(id)) ?? textIds[0]
  if (providerID === "groq") return textIds.find((id) => /llama|mixtral/i.test(id)) ?? textIds[0]
  if (providerID === "openrouter") return textIds.find((id) => /free/i.test(id)) ?? textIds[0]
  if (providerID === "google") {
    return textIds.find((id) => /gemini-(?:3(?:\.\d+)?|2\.5|2\.0|1\.5)-(?:flash|pro)/i.test(id)) ?? textIds[0]
  }
  return textIds[0]
}

export function fallbackProviders(configured: Record<string, unknown>, available: string[]): string[] {
  return available
    .filter((id) => configured[id] !== undefined || ["ollama", "groq", "openrouter", "google", "openai"].includes(id))
    .sort((a, b) => providerPriority(a) - providerPriority(b) || a.localeCompare(b))
}

export function isOllamaProvider(providerID: string): boolean {
  return providerID === "ollama"
}

export function ollamaBaseURL(): string {
  return "http://127.0.0.1:11434/v1"
}
