import { expect, test } from "bun:test"
import { steerActiveTask, type SteeringDeps, type SteerablePrompt } from "../../src/util/steering-flow"
import { STEERING_ACK, steeringStatusLine } from "../../src/util/steering"

const SECRET = "https://internal.corp/keys?id=42"

type Harness = ReturnType<typeof makeHarness>

function makeHarness(overrides: Partial<SteeringDeps> = {}) {
  const events: string[] = []
  const acks: string[] = []
  const queued: SteerablePrompt[] = []
  let cleared = false
  const deps: SteeringDeps = {
    currentStage: () => "Running tool…",
    abort: async () => {
      events.push("abort")
    },
    ack: (message) => acks.push(message),
    abortFailed: (error) => events.push(`abort-failed:${String(error)}`),
    askChangeChoice: async () => "replace" as const,
    enqueue: (item) => {
      queued.push(item)
      events.push("enqueue")
    },
    clearInput: () => {
      cleared = true
    },
    ...overrides,
  }
  return {
    deps,
    events,
    acks,
    queued,
    cleared: () => cleared,
  }
}

test("status question is answered locally with the redacted stage, no model path", async () => {
  const h = makeHarness()
  const result = await steerActiveTask("kya ho raha hai?", [], h.deps)
  expect(result).toEqual({ action: "status", aborted: false, queued: 0 })
  expect(h.acks).toEqual([steeringStatusLine("Running tool…")])
  expect(h.events).toEqual([])
  expect(h.queued.length).toBe(0)
  // The user's text stays in the editor; nothing is discarded.
  expect(h.cleared()).toBe(false)
})

test("status fallback uses the neutral stage when nothing is running", async () => {
  const h = makeHarness({ currentStage: () => undefined })
  await steerActiveText(h, "status?")
  expect(h.acks).toEqual(["Status: Thinking..."])
})

async function steerActiveText(h: Harness, text: string, parts: readonly unknown[] = []) {
  return steerActiveTask(text, parts, h.deps)
}

test("pure stop request aborts once and queues no phantom next prompt", async () => {
  for (const phrase of ["stop now", "stop it", "cancel the task", "ruko"]) {
    const h = makeHarness()
    const result = await steerActiveText(h, phrase)
    expect(result.aborted).toBe(true)
    expect(result.queued).toBe(0)
    expect(h.events.filter((x) => x === "abort").length).toBe(1)
    expect(h.queued.length).toBe(0)
    expect(h.cleared()).toBe(true)
  }
})

test("stop followed by real task text preserves only that task text", async () => {
  const h = makeHarness()
  const result = await steerActiveText(h, "stop now, run the typecheck")
  expect(result.action).toBe("stop")
  expect(result.queued).toBe(1)
  expect(h.queued[0]).toEqual({ kind: "next", input: "run the typecheck", parts: [] })
})

test("failed cancellation queues and clears nothing", async () => {
  const h = makeHarness({ abort: async () => Promise.reject(new Error("offline")) })
  const result = await steerActiveText(h, "stop")
  expect(result.aborted).toBe(false)
  expect(result.queued).toBe(0)
  expect(h.events[0]).toContain("abort-failed:")
  expect(h.queued.length).toBe(0)
  expect(h.cleared()).toBe(false)
})

test("cancel-and-replace aborts then queues the full message as next", async () => {
  const h = makeHarness({ askChangeChoice: async () => "replace" as const })
  const result = await steerActiveText(h, "instead deploy staging", [{ type: "file" }])
  expect(result).toEqual({ action: "change-replace", aborted: true, queued: 1 })
  expect(h.queued[0]?.kind).toBe("next")
  expect(h.queued[0]?.input).toBe("instead deploy staging")
  expect(h.cleared()).toBe(true)
})

test("keep-and-queue never touches the running task", async () => {
  const h = makeHarness({ askChangeChoice: async () => "queue" as const })
  const result = await steerActiveText(h, "actually use bun instead")
  expect(result).toEqual({ action: "change-queue", aborted: false, queued: 1 })
  expect(h.events).toEqual(["enqueue"])
  expect(h.queued[0]?.kind).toBe("followup")
})

test("dismissing the choice dialog leaves everything untouched", async () => {
  const h = makeHarness({ askChangeChoice: async () => undefined })
  const result = await steerActiveText(h, "wait no, different plan")
  expect(result).toEqual({ action: "change-dismissed", aborted: false, queued: 0 })
  expect(h.cleared()).toBe(false)
})

test("replace choice with a failing abort queues nothing", async () => {
  const h = makeHarness({
    askChangeChoice: async () => "replace" as const,
    abort: async () => Promise.reject(new Error("busy")),
  })
  const result = await steerActiveText(h, "scratch that, do X")
  expect(result.aborted).toBe(false)
  expect(h.queued.length).toBe(0)
  expect(h.cleared()).toBe(false)
})

test("normal follow-up is queued with the fixed acknowledgement and no abort", async () => {
  const h = makeHarness()
  const result = await steerActiveText(h, `please also check ${SECRET}`)
  expect(result).toEqual({ action: "followup", aborted: false, queued: 1 })
  expect(h.acks).toEqual([STEERING_ACK.followup])
  expect(h.acks.join("\n")).not.toContain(SECRET)
  expect(h.queued[0]?.input).toContain(SECRET)
})

test("every acknowledgement stays within the fixed constant set", async () => {
  const fixedAcks = new Set([...Object.values(STEERING_ACK), steeringStatusLine("Running tool…"), steeringStatusLine(undefined)])
  for (const input of [
    `${SECRET} stop`,
    "kya ho raha hai",
    "instead do this",
    "plain follow-up message",
  ]) {
    const h = makeHarness()
    await steerActiveText(h, input)
    for (const ack of h.acks) expect(fixedAcks.has(ack)).toBe(true)
  }
})
