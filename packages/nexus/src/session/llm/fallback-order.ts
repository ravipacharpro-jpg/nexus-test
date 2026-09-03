export type FallbackCandidate = {
  providerID: string
  modelID: string
}

/**
 * Static provider-policy categories are routing preferences only. They never
 * represent live balance, remaining allocation, account eligibility, or cost.
 */
export type ProviderAccessCategory = "verified-recurring-allocation" | "account-model-access" | "paid-or-unknown"

const providerAccess: Record<string, ProviderAccessCategory> = {
  "cloudflare-workers-ai": "verified-recurring-allocation",
  "nvidia-nim": "account-model-access",
}

const categoryRank: Record<ProviderAccessCategory, number> = {
  "verified-recurring-allocation": 0,
  "account-model-access": 1,
  "paid-or-unknown": 2,
}

export function providerAccessCategory(providerID: string): ProviderAccessCategory {
  return providerAccess[providerID] ?? "paid-or-unknown"
}

/**
 * Reorders only already-eligible fallback candidates. The caller must retain
 * the current/manual route separately as candidate zero.
 */
export function rankFallbackCandidates<T extends FallbackCandidate>(candidates: readonly T[]): T[] {
  return candidates
    .map((candidate, index) => ({ candidate, index, rank: categoryRank[providerAccessCategory(candidate.providerID)] }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((item) => item.candidate)
}

/** Keeps candidate zero unchanged and ranks only later candidates. */
export function rankCandidatesAfterPrimary<T extends FallbackCandidate>(candidates: readonly T[]): T[] {
  const [primary, ...fallbacks] = candidates
  return primary ? [primary, ...rankFallbackCandidates(fallbacks)] : []
}
