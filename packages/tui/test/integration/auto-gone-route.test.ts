/**
 * Integration coverage for the real Auto 410/Gone lifecycle at the closest
 * actual prompt/session event seam: an Auto-resolved submission marks its
 * route, a `message.updated` APIError(410) quarantines that exact route once
 * with one truthful notice, the failed request stays preserved (never silently
 * re-sent), the next Auto submission falls back to another configured route or
 * stops truthfully, and manual selections are never quarantined or switched.
 */
import { expect, test } from "bun:test"
import { resolveAutoModel } from "../../src/util/auto-model"
import { markAutoRoute, quarantinedRoutes, recordGoneRoute } from "../../src/util/auto-route-quarantine"
import type { AssistantMessage, Provider } from "@nexus-ai/sdk/v2"

function memoryKV() {
  const data: Record<string, unknown> = {}
  return {
    get: (key: string) => data[key],
    set: (key: string, value: unknown) => {
      data[key] = value
    },
  }
}

function provider(id: string, models: Partial<Provider["models"]>): Provider {
  return {
    id,
    name: id,
    source: "config",
    env: [],
    options: {},
    models: models as Provider["models"],
  }
}

function model(overrides: Record<string, unknown>) {
  return {
    id: "m",
    providerID: "p",
    api: { id: "m", url: "", npm: "" },
    name: "M",
    release_date: "2026-01-01",
    headers: {},
    options: {},
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      interleaved: false as const,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
    },
    cost: { input: 0.001, output: 0.002, cache: { read: 0, write: 0 } },
    limit: { context: 128_000, output: 8_000 },
    status: "active" as const,
    ...overrides,
  }
}

function assistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: "msg_1",
    sessionID: "ses_gone",
    role: "assistant",
    time: { created: 0 },
    parentID: "u1",
    modelID: "m",
    providerID: "p",
    mode: "default",
    ...overrides,
  } as AssistantMessage
}

const providers = [
  provider("cheap", {
    cheapchat: model({ id: "cheapchat", cost: { input: 0.00001, output: 0.00002, cache: { read: 0, write: 0 } } }),
  }),
  provider("strong", {
    bigreasoner: model({ id: "bigreasoner", cost: { input: 0.01, output: 0.02, cache: { read: 0, write: 0 } } }),
  }),
]

/** Mirrors the Prompt.submitInner Auto seam and the sync message.updated seam. */
function createHarness(overrides: { providers?: Provider[] } = {}) {
  const kv = memoryKV()
  const notices: Array<{ title?: string; message: string }> = []
  const notify = (notice: { title?: string; message: string }) => notices.push(notice)
  const sent: Array<string> = []
  let dispatched = 0
  const catalog = overrides.providers ?? providers

  // Production Auto submit path: resolve locally, track the route, one dispatch.
  function autoSubmit(sessionID: string, task: string): { sent?: string; blocked: boolean } {
    const resolved = resolveAutoModel({
      task,
      providers: catalog,
      connected: ["cheap", "strong"],
      keyHealth: [],
      quarantined: quarantinedRoutes(kv),
    })
    if (!resolved) return { blocked: true }
    markAutoRoute(sessionID, resolved.providerID, resolved.modelID)
    dispatched += 1
    sent.push(`${resolved.providerID}/${resolved.modelID}`)
    return { sent: sent.at(-1), blocked: false }
  }

  // Production sync seam for terminal assistant-message errors.
  function messageUpdated(message: AssistantMessage) {
    return recordGoneRoute(message, { kv, notify })
  }

  return {
    kv,
    notices,
    sent,
    dispatched: () => dispatched,
    autoSubmit,
    messageUpdated,
  }
}

test("Auto 410 quarantines the exact route once, with one truthful notice", () => {
  const h = createHarness()
  expect(h.autoSubmit("ses_gone", "hii kaisa hai").sent).toBe("cheap/cheapchat")

  const failing = assistantMessage({
    sessionID: "ses_gone",
    providerID: "cheap",
    modelID: "cheapchat",
    error: { name: "APIError", data: { message: "model retired", statusCode: 410, isRetryable: false } },
  })
  h.messageUpdated(failing)
  h.messageUpdated(failing)

  expect(quarantinedRoutes(h.kv)).toEqual(["cheap/cheapchat"])
  expect(h.notices.length).toBe(1)
  expect(h.notices[0]?.message).toContain("cheap/cheapchat")
})

test("the failed request is never re-sent automatically; next Auto submit falls back once", () => {
  const h = createHarness()
  h.autoSubmit("ses_gone", "hii")
  h.messageUpdated(
    assistantMessage({
      sessionID: "ses_gone",
      providerID: "cheap",
      modelID: "cheapchat",
      error: { name: "APIError", data: { message: "gone", statusCode: 410, isRetryable: false } },
    }),
  )
  expect(h.dispatched()).toBe(1)

  // Explicit user retry at the existing submit boundary picks another configured
  // compatible route and dispatches exactly once — no loop, no duplication.
  const retry = h.autoSubmit("ses_gone", "hii")
  expect(retry.sent).toBe("strong/bigreasoner")
  expect(h.dispatched()).toBe(2)
  expect(h.sent).toEqual(["cheap/cheapchat", "strong/bigreasoner"])
})

test("only the exact route is skipped: the provider's other models stay eligible", () => {
  const h = createHarness()
  const single = [provider("cheap", { cheapchat: model({}), cheapalt: model({ id: "cheapalt" }) })]
  h.autoSubmit("ses_gone", "hii")
  h.messageUpdated(
    assistantMessage({
      sessionID: "ses_gone",
      providerID: "cheap",
      modelID: "cheapchat",
      error: { name: "APIError", data: { message: "gone", statusCode: 410, isRetryable: false } },
    }),
  )
  const resolved = resolveAutoModel({
    task: "hii",
    providers: single,
    connected: ["cheap"],
    quarantined: quarantinedRoutes(h.kv),
  })
  expect(resolved?.providerID).toBe("cheap")
  expect(resolved?.modelID).toBe("cheapalt")
})

test("a manually selected model is never auto-quarantined or silently switched", () => {
  const h = createHarness()
  h.messageUpdated(
    assistantMessage({
      sessionID: "ses_manual",
      providerID: "cheap",
      modelID: "cheapchat",
      error: { name: "APIError", data: { message: "gone", statusCode: 410, isRetryable: false } },
    }),
  )
  expect(quarantinedRoutes(h.kv)).toEqual([])
  expect(h.notices.length).toBe(0)
})

test("when every eligible route is gone, Auto blocks truthfully instead of dispatching", () => {
  const h = createHarness({ providers: [providers[0]] })
  h.autoSubmit("ses_only", "hii")
  h.messageUpdated(
    assistantMessage({
      sessionID: "ses_only",
      providerID: "cheap",
      modelID: "cheapchat",
      error: { name: "APIError", data: { message: "gone", statusCode: 410, isRetryable: false } },
    }),
  )
  const retry = h.autoSubmit("ses_only", "hii")
  expect(retry.blocked).toBe(true)
  expect(retry.sent).toBeUndefined()
  expect(h.dispatched()).toBe(1)
})

test("notices are redacted: route identifiers only, no key material", () => {
  const h = createHarness()
  h.autoSubmit("ses_redact", "hii")
  h.messageUpdated(
    assistantMessage({
      sessionID: "ses_redact",
      providerID: "cheap",
      modelID: "cheapchat",
      error: {
        name: "APIError",
        data: { message: "sk-secret should never surface", statusCode: 410, isRetryable: false },
      },
    }),
  )
  expect(JSON.stringify(h.notices)).not.toContain("sk-secret")
  expect(h.notices[0]?.title).toBe("Model unavailable")
})
