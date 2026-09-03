import { NEXUS_API_KEY_PROVIDERS, type ProviderAccessCategory } from "./palette-api-key-providers"

type VaultStatus = "active" | "rate_limited" | "invalid" | "suspended" | "unknown"

export type ModelAvailability = {
  label: "Free-capable configured" | "Configured" | "No API key" | "Paused after observed rate limit" | "Paused after observed cooldown" | "Invalid/needs recheck" | "Unknown"
  detail: string
}

export type ModelAvailabilityInput = {
  provider: string
  model: string
  activeModels: Array<{ provider: string; model: string; status: VaultStatus }>
  keys: Array<{ provider: string; keys: Array<{ status: VaultStatus }> }>
}

function sameProvider(left: string, right: string) {
  if (left === right) return true
  return (left === "gemini" && right === "google") || (left === "google" && right === "gemini")
}

function providerAccess(provider: string): ProviderAccessCategory | undefined {
  return NEXUS_API_KEY_PROVIDERS.find((item) => item.id === provider)?.access
}

function configuredLabel(provider: string): ModelAvailability {
  const access = providerAccess(provider)
  if (access === "verified-recurring" || access === "conditional-free") {
    return {
      label: "Free-capable configured",
      detail: "Local configuration is active; provider-specific free access remains conditional.",
    }
  }
  return { label: "Configured", detail: "Local configuration is active for this model." }
}

export function modelAvailability(input: ModelAvailabilityInput): ModelAvailability {
  const active = input.activeModels.find(
    (item) => sameProvider(item.provider, input.provider) && item.model === input.model,
  )
  if (active?.status === "active") return configuredLabel(input.provider)
  if (active?.status === "rate_limited") {
    return {
      label: "Paused after observed rate limit",
      detail: "NEXUS observed a provider rate limit; this is not a remaining-token or balance reading.",
    }
  }
  if (active?.status === "invalid") return { label: "Invalid/needs recheck", detail: "Local validation marked the configured key invalid." }
  if (active?.status === "suspended") return { label: "Paused after observed cooldown", detail: "NEXUS has an observed local cooldown for this configured route." }

  const statuses = input.keys
    .filter((item) => sameProvider(item.provider, input.provider))
    .flatMap((item) => item.keys.map((key) => key.status))
  if (statuses.length === 0) {
    if (!providerAccess(input.provider)) {
      return { label: "Unknown", detail: "No local API-vault state is exposed for this provider." }
    }
    return { label: "No API key", detail: "No local API-key configuration is known for this provider." }
  }
  if (statuses.includes("invalid")) return { label: "Invalid/needs recheck", detail: "A local configured key needs revalidation." }
  if (statuses.includes("rate_limited")) {
    return {
      label: "Paused after observed rate limit",
      detail: "NEXUS observed a provider rate limit; this is not a remaining-token or balance reading.",
    }
  }
  if (statuses.includes("suspended")) return { label: "Paused after observed cooldown", detail: "A local configured key is in cooldown." }
  return { label: "Unknown", detail: "A local key exists, but this model has no confirmed active route state." }
}
