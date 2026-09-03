import { describe, expect, test } from "bun:test"
import { modelAvailability } from "./model-availability"

describe("Switch Model availability labels", () => {
  test("shows configured free-capable and configured labels only from active local model status", () => {
    expect(
      modelAvailability({
        provider: "groq",
        model: "openai/gpt-oss-120b",
        activeModels: [{ provider: "groq", model: "openai/gpt-oss-120b", status: "active" }],
        keys: [],
      }),
    ).toMatchObject({ label: "Free-capable configured" })
    expect(
      modelAvailability({
        provider: "openai",
        model: "gpt-4o-mini",
        activeModels: [{ provider: "openai", model: "gpt-4o-mini", status: "active" }],
        keys: [],
      }),
    ).toMatchObject({ label: "Configured" })
  })

  test("shows factual invalid and observed cooldown labels without a token or balance claim", () => {
    expect(
      modelAvailability({
        provider: "gemini",
        model: "gemini-3.6-flash",
        activeModels: [{ provider: "google", model: "gemini-3.6-flash", status: "rate_limited" }],
        keys: [],
      }),
    ).toMatchObject({ label: "Paused after observed rate limit" })
    expect(
      modelAvailability({
        provider: "groq",
        model: "openai/gpt-oss-120b",
        activeModels: [],
        keys: [{ provider: "groq", keys: [{ status: "invalid" }] }],
      }),
    ).toMatchObject({ label: "Invalid/needs recheck" })
    expect(
      modelAvailability({
        provider: "nvidia-nim",
        model: "meta/llama-3.3-70b-instruct",
        activeModels: [],
        keys: [{ provider: "nvidia-nim", keys: [{ status: "suspended" }] }],
      }),
    ).toMatchObject({ label: "Paused after observed cooldown" })
  })

  test("does not turn missing or unconfirmed local state into a route, balance, or token claim", () => {
    expect(
      modelAvailability({ provider: "mistral", model: "mistral-small", activeModels: [], keys: [] }),
    ).toMatchObject({ label: "No API key" })
    const unknown = modelAvailability({
      provider: "groq",
      model: "not-observed",
      activeModels: [],
      keys: [{ provider: "groq", keys: [{ status: "active" }] }],
    })
    expect(unknown).toMatchObject({ label: "Unknown" })
    expect(unknown.detail.toLowerCase()).not.toContain("token")
    expect(unknown.detail.toLowerCase()).not.toContain("balance")
  })
})
