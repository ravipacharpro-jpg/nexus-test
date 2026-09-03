import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { looksFree, readVaultKeys, suggestTop3 } from "../../src/util/top3-models"

describe("top3-models", () => {
  test("looksFree accepts known-free model patterns", () => {
    expect(looksFree("llama-3.1-70b")).toBe(true)
    expect(looksFree("gpt-4o-mini")).toBe(true)
    expect(looksFree("deepseek-chat")).toBe(true)
    expect(looksFree("claude-3-haiku-20240307")).toBe(true)
    expect(looksFree("gemini-1.5-flash")).toBe(true)
  })

  test("looksFree rejects obviously-paid model patterns", () => {
    // No "free" hint in the id → treated as not free.
    expect(looksFree("gpt-5-turbo")).toBe(false)
    expect(looksFree("claude-opus-4")).toBe(false)
  })

  test("readVaultKeys returns empty when vault file is missing", () => {
    const tmp = path.join(os.tmpdir(), `vault-missing-${Date.now()}.json`)
    const result = readVaultKeys(tmp)
    expect(result).toEqual([])
  })

  test("readVaultKeys returns one slot per active provider, skipping non-active", () => {
    const tmp = path.join(os.tmpdir(), `vault-${Date.now()}.json`)
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        providers: {
          groq: [{ key: "g-1", status: "active", source: "farm" }],
          openrouter: [
            { key: "or-1", status: "invalid", source: "farm" },
            { key: "or-2", status: "active", source: "farm" },
          ],
          cerebras: [{ key: "c-1", status: "expired", source: "farm" }],
        },
      }),
    )
    const result = readVaultKeys(tmp)
    const names = result.map((r) => r.name).sort()
    expect(names).toEqual(["groq", "openrouter"])
    // One key per provider.
    expect(result.find((r) => r.name === "groq")?.apiKey).toBe("g-1")
    // Infer base URL works.
    expect(result.find((r) => r.name === "groq")?.baseUrl).toBe("https://api.groq.com/openai/v1")
    fs.unlinkSync(tmp)
  })

  test("readVaultKeys returns [] on corrupt JSON", () => {
    const tmp = path.join(os.tmpdir(), `vault-corrupt-${Date.now()}.json`)
    fs.writeFileSync(tmp, "not-json{")
    expect(readVaultKeys(tmp)).toEqual([])
    fs.unlinkSync(tmp)
  })

  test("suggestTop3 degrades gracefully when no providers are reachable", async () => {
    // Use a vault path that doesn't exist + skipProbe so the call is fast.
    const tmp = path.join(os.tmpdir(), `vault-empty-${Date.now()}.json`)
    const result = await suggestTop3({ topN: 3, skipProbe: true, vaultPath: tmp, timeoutMs: 500 })
    // We can't assert on the *content* (depends on whether opencode.ai is reachable from CI),
    // but we can assert the function returns an array of the right shape.
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBeLessThanOrEqual(3)
  })
})
