import { describe, expect, test } from "bun:test"
import { NEXUS_API_KEY_PROVIDERS, rankedApiKeyProviders } from "./palette-api-key-providers"

describe("NEXUS API provider picker policy", () => {
  test("ranks source-backed recurring free access before conditional and account-specific access", () => {
    const ranked = rankedApiKeyProviders()
    expect(ranked.map((provider) => provider.id).slice(0, 5)).toEqual([
      "cloudflare-workers-ai",
      "groq",
      "gemini",
      "openrouter",
      "nvidia-nim",
    ])
    expect(ranked.find((provider) => provider.id === "cloudflare-workers-ai")).toMatchObject({
      access: "verified-recurring",
      badge: "Verified daily allocation",
    })
    expect(ranked.find((provider) => provider.id === "groq")).toMatchObject({
      access: "verified-recurring",
      badge: "Free plan — model limits",
    })
    expect(ranked.find((provider) => provider.id === "gemini")).toMatchObject({
      access: "verified-recurring",
      badge: "Free tier — project/model limits",
    })
    expect(ranked.find((provider) => provider.id === "openrouter")).toMatchObject({
      access: "conditional-free",
      badge: "Conditional free models",
    })
    expect(ranked.find((provider) => provider.id === "nvidia-nim")).toMatchObject({
      access: "account-specific",
      badge: "Account/model access",
    })
  })

  test("never shows fixed quota figures or account-balance implications", () => {
    for (const provider of NEXUS_API_KEY_PROVIDERS) {
      expect(provider.badge ?? "").not.toMatch(/\d/)
      expect(provider.detail ?? "").not.toMatch(/\d/)
      expect(Object.keys(provider)).not.toContain("freeDaily")
    }
  })

  test("keeps custom onboarding available while omitting fabricated free-quota badges", () => {
    expect(NEXUS_API_KEY_PROVIDERS.find((provider) => provider.id === "custom")).toMatchObject({ access: "custom" })
    expect(
      NEXUS_API_KEY_PROVIDERS.filter((provider) => provider.access === "paid-or-unknown").every(
        (provider) => !provider.badge,
      ),
    ).toBe(true)
  })
})
