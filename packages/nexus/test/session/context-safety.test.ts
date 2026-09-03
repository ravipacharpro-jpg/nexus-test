import { describe, expect, test } from "bun:test"
import {
  MAX_CONTEXT_ENTRY_CHARS,
  MAX_CONTEXT_TOTAL_CHARS,
  boundedRedactedContext,
  contextSafetyNotice,
} from "../../src/session/context-safety"

describe("compaction context safety", () => {
  test("redacts credential assignments and standalone provider-style keys before model context", () => {
    const safe = boundedRedactedContext([
      "API_KEY=abc123secret\nAuthorization: Bearer tokensecretvalue\nsk-abcdefghijklmnop",
    ])
    expect(safe.entries.join("\n")).not.toContain("abc123secret")
    expect(safe.entries.join("\n")).not.toContain("tokensecretvalue")
    expect(safe.entries.join("\n")).not.toContain("sk-abcdefghijklmnop")
    expect(contextSafetyNotice(safe)).toContain("redacted")
  })

  test("bounds oversized context locally without changing source strings", () => {
    const source = "x".repeat(MAX_CONTEXT_ENTRY_CHARS + 100)
    const safe = boundedRedactedContext([source, ...Array.from({ length: 100 }, () => "y".repeat(2_000))])
    expect(source).toHaveLength(MAX_CONTEXT_ENTRY_CHARS + 100)
    expect(safe.entries.every((entry) => entry.length <= MAX_CONTEXT_ENTRY_CHARS)).toBe(true)
    expect(safe.entries.join("").length).toBeLessThanOrEqual(MAX_CONTEXT_TOTAL_CHARS)
    expect(safe.truncatedEntries).toBeGreaterThan(0)
    expect(safe.skippedEntries).toBeGreaterThan(0)
  })
})
