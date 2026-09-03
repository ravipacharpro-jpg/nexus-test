import { expect, test } from "bun:test"
import {
  goneRoute,
  quarantinedRoutes,
  quarantineRoute,
  quotaRoute,
  cooldownRoute,
  recordGoneRoute,
  markAutoRoute,
} from "../../src/util/auto-route-quarantine"
import type { AssistantMessage } from "@nexus-ai/sdk/v2"

function memoryKV(initial: Record<string, unknown> = {}) {
  const data = structuredClone(initial)
  return {
    get: (key: string) => data[key],
    set: (key: string, value: unknown) => {
      data[key] = value
    },
    data,
  }
}

function assistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: "msg_1",
    sessionID: "s1",
    role: "assistant",
    time: { created: 0 },
    parentID: "u1",
    modelID: "m",
    providerID: "p",
    mode: "default",
    ...overrides,
  } as AssistantMessage
}

test("a 410/Gone result marks its exact route gone", () => {
  const message = assistantMessage({
    providerID: "anthropic",
    modelID: "legacy-model",
    error: {
      name: "APIError",
      data: { message: "model retired", statusCode: 410, isRetryable: false },
    },
  })
  expect(goneRoute(message)).toEqual({ providerID: "anthropic", modelID: "legacy-model" })
})

test("other runtime failures are not treated as EOL", () => {
  for (const statusCode of [429, 500, 404, undefined]) {
    const message = assistantMessage({
      error: { name: "APIError", data: { message: "boom", statusCode, isRetryable: false } },
    })
    expect(goneRoute(message)).toBeUndefined()
  }
  expect(goneRoute(assistantMessage({ error: { name: "MessageAbortedError", data: { message: "aborted" } } }))).toBeUndefined()
  expect(goneRoute(assistantMessage())).toBeUndefined()
})

test("quarantine persists per route and never duplicates", () => {
  const kv = memoryKV()
  quarantineRoute(kv, "p", "m")
  quarantineRoute(kv, "p", "m")
  quarantineRoute(kv, "q", "n")
  expect(quarantinedRoutes(kv)).toEqual(["p/m", "q/n"])
})

test("corrupted quarantine state degrades to an empty list without throwing", () => {
  expect(quarantinedRoutes(memoryKV({ auto_route_quarantine: "junk" }))).toEqual([])
  expect(quarantinedRoutes(memoryKV({ auto_route_quarantine: [1, "p/m", null] }))).toEqual(["p/m"])
})

test("classifies quota responses and respects retry-after seconds", () => {
  const result = quotaRoute(
    assistantMessage({
      providerID: "google",
      modelID: "gemini-3.6-flash",
      error: {
        name: "APIError",
        data: {
          message: "You exceeded your current quota",
          statusCode: 429,
          isRetryable: true,
          responseHeaders: { "retry-after": "42" },
        },
      },
    }),
  )
  expect(result).toEqual({ providerID: "google", modelID: "gemini-3.6-flash", cooldownMs: 42_000 })
})

test("quota cooldown accepts fractional retry-after values", () => {
  const result = quotaRoute(
    assistantMessage({
      providerID: "google",
      modelID: "gemini-3.6-flash",
      error: {
        name: "APIError",
        data: {
          message: "You exceeded your current quota. Please retry in 42.5 seconds.",
          statusCode: 429,
          isRetryable: true,
        },
      },
    }),
  )
  expect(result?.cooldownMs).toBe(42_500)
})

test("quota cooldown is scoped to the exact provider/model route", () => {
  const kv = memoryKV()
  cooldownRoute(kv, "google", "gemini-3.6-flash", 42_000, 1_000)
  expect(quarantinedRoutes(kv, 1_001)).toEqual(["google/gemini-3.6-flash"])
  expect(quarantinedRoutes(kv, 43_001)).toEqual([])
})

test("Auto quota failure pauses the route once and suppresses repeated notifications", () => {
  const kv = memoryKV()
  const notices: string[] = []
  markAutoRoute("s1", "google", "gemini-3.6-flash")
  const message = assistantMessage({
    providerID: "google",
    modelID: "gemini-3.6-flash",
    error: {
      name: "APIError",
      data: { message: "quota exceeded; retry in 30s", statusCode: 429, isRetryable: true },
    },
  })
  const notify = (notice: { message: string }) => notices.push(notice.message)
  expect(recordGoneRoute(message, { kv, notify })).toEqual({ quarantined: true })
  expect(recordGoneRoute(message, { kv, notify })).toEqual({ quarantined: true })
  expect(notices).toHaveLength(1)
  expect(quarantinedRoutes(kv)).toEqual(["google/gemini-3.6-flash"])
})
