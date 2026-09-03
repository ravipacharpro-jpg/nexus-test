import { availableApiKeys, type ApiProvider, loadApiVault } from "./ApiVault"

export interface ModelRoute {
  alias: string
  provider: ApiProvider | "ollama"
  model: string
  reason: string
}

export const MODEL_MAP = {
  deepseek: {
    providers: ["deepseek", "openrouter", "groq"] as const,
    providerModels: {
      deepseek: "deepseek-chat",
      openrouter: "deepseek/deepseek-chat",
      groq: undefined,
    },
  },
  llama3_1: {
    providers: ["groq", "openrouter", "cerebras"] as const,
    providerModels: {
      groq: "openai/gpt-oss-120b",
      openrouter: "meta-llama/llama-3.1-8b-instruct:free",
      cerebras: "llama3.1-8b",
    },
  },
  gemini: {
    providers: ["gemini", "openrouter"] as const,
    providerModels: {
      gemini: "gemini-2.5-flash",
      openrouter: "google/gemini-2.5-flash",
    },
  },
  gpt4: {
    providers: ["openrouter"] as const,
    providerModels: {
      openrouter: "openai/gpt-4o-mini",
    },
  },
} as const

function canonicalAlias(input: string): keyof typeof MODEL_MAP | undefined {
  const normalized = input.trim().toLowerCase().replace(/[./:-]+/g, "_")
  if (normalized === "deepseek" || normalized.includes("deepseek")) return "deepseek"
  if (normalized === "llama3_1" || normalized === "llama31" || normalized.includes("llama_3_1") || normalized.includes("llama3_1")) return "llama3_1"
  if (normalized === "gemini" || normalized.includes("gemini")) return "gemini"
  if (normalized === "gpt4" || normalized.includes("gpt_4") || normalized.includes("gpt4")) return "gpt4"
  return undefined
}

function providerConfigured(provider: string): boolean {
  if (provider === "ollama") return true
  return availableApiKeys(provider).length > 0
}

export function resolveModelAlias(input: string): string {
  return canonicalAlias(input) ?? input.trim()
}

export function routeModel(input: string, options: { includeLocal?: boolean } = {}): ModelRoute[] {
  const requested = input.trim()
  const alias = canonicalAlias(requested)
  const routes: ModelRoute[] = []
  if (alias) {
    const definition = MODEL_MAP[alias]
    for (const provider of definition.providers) {
      const model = definition.providerModels[provider as keyof typeof definition.providerModels]
      if (!model || !providerConfigured(provider)) continue
      routes.push({ alias, provider, model, reason: provider === definition.providers[0] ? "preferred provider" : "model-compatible fallback" })
    }
    if (options.includeLocal !== false) routes.push({ alias, provider: "ollama", model: alias === "deepseek" ? "llama3" : alias === "gemini" ? "llama3" : "llama3", reason: "local fallback" })
    return routes
  }
  const slash = requested.indexOf("/")
  if (slash > 0) {
    const provider = requested.slice(0, slash) as ApiProvider
    const model = requested.slice(slash + 1)
    if (provider === "ollama" || providerConfigured(provider)) return [{ alias: requested, provider, model, reason: "explicit provider/model" }]
  }
  if (options.includeLocal === false) return []
  return [{ alias: requested, provider: "ollama", model: requested || "llama3", reason: "local/default route" }]
}

export function configuredRoutes(input: string): ModelRoute[] {
  return routeModel(input, { includeLocal: false })
}

export function routeSummary(input: string): string {
  const routes = routeModel(input)
  return routes.map((route) => `${route.provider}/${route.model}`).join(" → ")
}

export function providerModelForAlias(aliasInput: string, provider: string): string | undefined {
  const alias = canonicalAlias(aliasInput)
  if (!alias) return undefined
  const definition = MODEL_MAP[alias]
  return definition.providerModels[provider as keyof typeof definition.providerModels] as string | undefined
}

export function vaultProviderOrder(): string[] {
  const vault = loadApiVault()
  return Object.keys(vault.providers).sort((a, b) => {
    const priority = [
      "anthropic",
      "openai",
      "deepseek",
      "groq",
      "openrouter",
      "gemini",
      "xai",
      "mistral",
      "cerebras",
      "togetherai",
      "fireworks",
      "moonshotai",
      "cohere",
      "perplexity",
    ]
    return (priority.indexOf(a) === -1 ? 99 : priority.indexOf(a)) - (priority.indexOf(b) === -1 ? 99 : priority.indexOf(b))
  })
}

export function isKnownModelAlias(input: string): boolean {
  return canonicalAlias(input) !== undefined
}
