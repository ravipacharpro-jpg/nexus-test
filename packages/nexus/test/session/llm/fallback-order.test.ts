import { describe, expect, test } from "bun:test"
import {
  providerAccessCategory,
  rankCandidatesAfterPrimary,
  rankFallbackCandidates,
} from "../../../src/session/llm/fallback-order"

describe("Auto Model fallback policy ordering", () => {
  test("uses only static provider-policy categories and does not claim live account or quota state", () => {
    expect(providerAccessCategory("cloudflare-workers-ai")).toBe("verified-recurring-allocation")
    expect(providerAccessCategory("nvidia-nim")).toBe("account-model-access")
    expect(providerAccessCategory("openrouter")).toBe("paid-or-unknown")
    expect(providerAccessCategory("unconfigured-provider")).toBe("paid-or-unknown")
  })

  test("ranks only later fallback candidates while preserving stable same-category ordering", () => {
    const laterFallbacks = [
      { providerID: "openrouter", modelID: "manual-current-must-not-be-passed-here" },
      { providerID: "nvidia-nim", modelID: "nim-model" },
      { providerID: "cloudflare-workers-ai", modelID: "cf-model" },
      { providerID: "groq", modelID: "groq-model" },
    ]

    expect(rankFallbackCandidates(laterFallbacks)).toEqual([
      { providerID: "cloudflare-workers-ai", modelID: "cf-model" },
      { providerID: "nvidia-nim", modelID: "nim-model" },
      { providerID: "openrouter", modelID: "manual-current-must-not-be-passed-here" },
      { providerID: "groq", modelID: "groq-model" },
    ])
    expect(JSON.stringify(rankFallbackCandidates(laterFallbacks))).not.toContain("apiKey")
    expect(JSON.stringify(rankFallbackCandidates(laterFallbacks))).not.toContain("quota")
  })

  test("retains the manual/current route at candidate zero before ranking later fallbacks", () => {
    const candidates = [
      { providerID: "openrouter", modelID: "manual-current" },
      { providerID: "nvidia-nim", modelID: "nim-model" },
      { providerID: "cloudflare-workers-ai", modelID: "cf-model" },
    ]

    expect(rankCandidatesAfterPrimary(candidates)).toEqual([
      { providerID: "openrouter", modelID: "manual-current" },
      { providerID: "cloudflare-workers-ai", modelID: "cf-model" },
      { providerID: "nvidia-nim", modelID: "nim-model" },
    ])
  })
})
