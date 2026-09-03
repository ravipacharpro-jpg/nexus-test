import { describe, expect, test } from "bun:test"
import type { Part, SessionStatus } from "@nexus-ai/sdk/v2"
import { deriveSessionActivity } from "./session-activity"

const part = (value: Record<string, unknown>) => value as Part
const busy = { type: "busy" } as SessionStatus

describe("deriveSessionActivity", () => {
  test("uses only real busy parts for thinking, writing, and tool activity", () => {
    expect(deriveSessionActivity({ status: busy, parts: [part({ type: "reasoning" })] })).toMatchObject({
      phase: "thinking",
      label: "Thinking",
    })
    expect(deriveSessionActivity({ status: busy, parts: [part({ type: "text" })] })).toMatchObject({
      phase: "writing",
      label: "Writing response",
    })
    expect(deriveSessionActivity({ status: busy, parts: [part({ type: "tool", tool: "bun test" })] })).toMatchObject({
      phase: "tool",
      label: "Testing",
    })
  })

  test("shows fallback only for a real retry status and hides idle sessions", () => {
    expect(
      deriveSessionActivity({
        status: { type: "retry", attempt: 1, message: "provider busy", next: 5 },
        parts: [],
      }),
    ).toMatchObject({ phase: "fallback", label: "Retrying route", tone: "warning" })
    expect(deriveSessionActivity({ status: { type: "idle" }, parts: [] })).toBeUndefined()
  })

  test("shows an error only when the assistant message has a real error", () => {
    expect(
      deriveSessionActivity({ status: { type: "idle" }, parts: [], error: { name: "ProviderError" } }),
    ).toMatchObject({ phase: "error", label: "Action failed", tone: "error" })
  })

  test("shows waiting and completion only when supplied by real external session signals", () => {
    expect(deriveSessionActivity({ status: { type: "busy" }, parts: [], waiting: true })).toMatchObject({
      phase: "waiting",
      label: "Waiting for approval",
      tone: "warning",
    })
    expect(deriveSessionActivity({ status: { type: "idle" }, parts: [], completed: true })).toMatchObject({
      label: "Completed",
      tone: "muted",
    })
  })

  test("does not expose raw tool arguments or retry text", () => {
    const value = deriveSessionActivity({
      status: { type: "retry", attempt: 1, message: "sk-secret-value", next: 5 },
      parts: [part({ type: "tool", tool: "write" })],
    })
    expect(JSON.stringify(value)).not.toContain("sk-secret-value")
  })
})
