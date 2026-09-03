import { expect, test } from "bun:test"
import { NEXUS_API_KEY_PROVIDERS } from "@/components/palette-api-key-providers"

test("Ctrl+P API-key picker exposes the rotation-backed provider set", () => {
  expect(NEXUS_API_KEY_PROVIDERS.map((provider) => provider.id)).toEqual([
    "groq", "openrouter", "deepseek", "gemini", "cerebras", "openai", "opencode", "anthropic", "xai", "mistral", "togetherai", "perplexity", "cohere", "fireworks", "moonshotai", "custom",
  ])
})
