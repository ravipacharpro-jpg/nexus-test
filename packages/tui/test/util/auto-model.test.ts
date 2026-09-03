import { expect, test } from "bun:test"
import { resolveAutoModel } from "../../src/util/auto-model"
import type { Provider } from "@nexus-ai/sdk/v2"

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

const providers = [
  provider("cheap", {
    cheapchat: model({ id: "cheapchat", cost: { input: 0.00001, output: 0.00002, cache: { read: 0, write: 0 } } }),
  }),
  provider("strong", {
    bigreasoner: model({
      id: "bigreasoner",
      capabilities: model({}).capabilities,
      reasoning: undefined,
    }),
  }),
]

test("plain chat picks the cheapest capable model", () => {
  const result = resolveAutoModel({ task: "hii kaisa hai", providers })
  expect(result?.providerID).toBe("cheap")
  expect(result?.modelID).toBe("cheapchat")
  expect(result?.reason).toBe("chat")
})

test("coding tasks prefer the cheapest tool-capable model over an unnecessarily stronger model", () => {
  const cheapTools = provider("cheap-tools", {
    fast: model({
      id: "fast",
      cost: { input: 0.00001, output: 0.00002, cache: { read: 0, write: 0 } },
    }),
  })
  const expensiveReasoning = provider("expensive-reasoning", {
    deep: model({
      id: "deep",
      cost: { input: 0.01, output: 0.02, cache: { read: 0, write: 0 } },
      capabilities: { ...model({}).capabilities, reasoning: true },
    }),
  })
  const result = resolveAutoModel({ task: "fix this code", providers: [expensiveReasoning, cheapTools] })
  expect(result).toEqual({ providerID: "cheap-tools", modelID: "fast", reason: "tools" })
})

test("vision tasks only consider image-capable models", () => {
  const vision = provider("vision", {
    eyes: model({
      id: "eyes",
      capabilities: {
        ...model({}).capabilities,
        attachment: true,
        input: { ...model({}).capabilities.input, image: true },
      },
    }),
  })
  const result = resolveAutoModel({ task: "is screenshot me kya hai", providers: [providers[0], vision] })
  expect(result?.providerID).toBe("vision")
  expect(result?.modelID).toBe("eyes")
})

test("image attachments trigger vision routing without keywords", () => {
  const vision = provider("vision", {
    eyes: model({
      id: "eyes",
      capabilities: {
        ...model({}).capabilities,
        attachment: true,
        input: { ...model({}).capabilities.input, image: true },
      },
    }),
  })
  const result = resolveAutoModel({ task: "what is this", hasImage: true, providers: [providers[0], vision] })
  expect(result?.providerID).toBe("vision")
})

test("returns undefined when no model satisfies the requirements", () => {
  const result = resolveAutoModel({ task: "analyze the architecture trade-offs", providers: [providers[0]] })
  expect(result).toBeUndefined()
})

test("deprecated models are never selected", () => {
  const stale = provider("stale", {
    old: model({ id: "old", status: "deprecated", cost: { input: 0, output: 0, cache: { read: 0, write: 0 } } }),
  })
  const result = resolveAutoModel({ task: "hii", providers: [stale] })
  expect(result).toBeUndefined()
})

test("catalog providers without configured credentials are never selected", () => {
  const result = resolveAutoModel({
    task: "hii",
    providers,
    connected: ["strong"],
  })
  expect(result?.providerID).toBe("strong")
  expect(result?.modelID).toBe("bigreasoner")
})

test("nothing is selected when no provider is connected", () => {
  const result = resolveAutoModel({ task: "hii", providers, connected: [] })
  expect(result).toBeUndefined()
})

test("a provider with multiple keys stays eligible while one usable key remains", () => {
  const keyHealth = [{ provider: "cheap", keys: [{ status: "invalid" }, { status: "active" }] }]
  const result = resolveAutoModel({ task: "hii", providers: [providers[0]], connected: ["cheap"], keyHealth })
  expect(result?.providerID).toBe("cheap")
})

test("a provider whose every key is locally known-bad is never selected", () => {
  const keyHealth = [{ provider: "cheap", keys: [{ status: "invalid" }, { status: "suspended" }] }]
  const result = resolveAutoModel({ task: "hii", providers: [providers[0]], connected: ["cheap"], keyHealth })
  expect(result).toBeUndefined()
})

test("quarantined routes fall back to another configured compatible route", () => {
  const result = resolveAutoModel({
    task: "hii",
    providers,
    connected: ["cheap", "strong"],
    quarantined: ["cheap/cheapchat"],
  })
  expect(result?.providerID).toBe("strong")
})

test("quarantine is exact-route: other models on the same provider stay eligible", () => {
  const both = provider("cheap", {
    cheapchat: model({ id: "cheapchat" }),
    cheapalt: model({ id: "cheapalt", cost: { input: 0.00002, output: 0.00004, cache: { read: 0, write: 0 } } }),
  })
  const result = resolveAutoModel({
    task: "hii",
    providers: [both],
    connected: ["cheap"],
    quarantined: ["cheap/cheapchat"],
  })
  expect(result?.providerID).toBe("cheap")
  expect(result?.modelID).toBe("cheapalt")
})

test("no compatible route exists when every eligible route is quarantined", () => {
  const result = resolveAutoModel({
    task: "hii",
    providers: [providers[0]],
    connected: ["cheap"],
    quarantined: ["cheap/cheapchat"],
  })
  expect(result).toBeUndefined()
})

test("the choice carries only fixed redacted fields", () => {
  const result = resolveAutoModel({
    task: "hii",
    providers,
    connected: ["cheap"],
    keyHealth: [{ provider: "cheap", keys: [{ status: "sk-secret-material" }] }],
  })
  expect(Object.keys(result ?? {}).sort()).toEqual(["modelID", "providerID", "reason"])
  expect(JSON.stringify(result)).not.toContain("sk-secret-material")
})

test("selection is synchronous and performs no network work", () => {
  const result = resolveAutoModel({ task: "hii", providers, connected: ["cheap"] })
  expect(!(result instanceof Promise)).toBe(true)
})
