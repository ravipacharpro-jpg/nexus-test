// @ts-nocheck -- this file is executed by Bun's test runner; production code remains type-checked separately.
import { expect, test } from "bun:test"
import { Businessman } from "./Businessman"
import type { StaffManager } from "./StaffManager"

const taskPlan = { workersNeeded: ["first", "second"], estimatedSize: "0MB", estimatedTime: "instant", taskType: "bot" }

function memoryQueue() {
  const updates: Array<{ id: string; state: string; error?: string }> = []
  return {
    accept: async (id: string) => id,
    update: async (id: string, state: string, error?: string) => { updates.push({ id, state, error }) },
    updates,
  }
}

function recoveryQueue(records: any[]) {
  const updates: Array<{ id: string; state: string; error?: string }> = []
  const accepted: Array<{ id: string; attempts?: number }> = []
  return {
    accept: async (id: string, _task: string, _root: string, _capacity: unknown, attempts?: number) => {
      accepted.push({ id, attempts })
      return { id }
    },
    update: async (id: string, state: string, error?: string) => { updates.push({ id, state, error }) },
    stalePending: async (before: number) => records.filter((record) => record.updatedAt < before),
    list: async () => records,
    updates,
    accepted,
  }
}

function staffStub(matchedWorkers: string[] = [], hiredNames: string[] = []) {
  return {
    brain: { analyze: () => taskPlan, matchFreelancers: () => matchedWorkers },
    hire: { hire: async (worker: string) => { hiredNames.push(worker); return { success: true, sizeMB: 0 } } },
    fire: { fireMany: async () => 0 },
  } as unknown as StaffManager
}

const healthyServices = () => ({
  acquireWakeLock: async () => {},
  releaseWakeLock: async () => {},
  notify: async () => {},
  toast: async () => {},
})

function staleRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-stale",
    task: "build the old thing",
    root: "/tmp",
    state: "accepted",
    capacity: { device: "PC" },
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now() - 60_000,
    ...overrides,
  }
}

test("throttles low-battery mobile tasks to one worker and releases the wake lock", async () => {
  const hired: string[] = []
  const calls: string[] = []
  const staff = {
    brain: { analyze: () => taskPlan, matchFreelancers: () => ["first", "second"] },
    hire: { hire: async (worker: string) => { hired.push(worker); return { success: true, sizeMB: 0 } }, },
    fire: { fireMany: async () => 0 },
  } as unknown as StaffManager
  const services = {
    acquireWakeLock: async () => { calls.push("lock") },
    releaseWakeLock: async () => { calls.push("unlock") },
    notify: async () => { calls.push("notify") },
    toast: async () => { calls.push("toast") },
  }
  const businessman = new Businessman({
    staff,
    services,
    botAgent: { execute: async () => ({}) },
    debugAgent: { execute: async () => ({}) },
    readPowerStatus: async () => ({ batteryPercent: 10, source: "termux" }),
    runtimeGuard: async () => ({ ok: true }),
    queue: memoryQueue(),
  })
  businessman.askUser = async () => false
  await businessman.handleTask("build")
  expect(hired).toEqual(["first"])
  expect(calls).toContain("lock")
  expect(calls).toContain("unlock")
})

test("releases wake locks and sends best-effort failure alerts when execution throws", async () => {
  const calls: string[] = []
  const staff = {
    brain: { analyze: () => taskPlan, matchFreelancers: () => [] },
    hire: { hire: async () => ({ success: true, sizeMB: 0 }) },
    fire: { fireMany: async () => 0 },
  } as unknown as StaffManager
  const businessman = new Businessman({
    staff,
    services: {
      acquireWakeLock: async () => { calls.push("lock") },
      releaseWakeLock: async () => { calls.push("unlock") },
      notify: async (title: string) => { calls.push(title) },
      toast: async (message: string) => { calls.push(message) },
    },
    botAgent: { execute: async () => { throw new Error("boom") } },
    debugAgent: { execute: async () => ({}) },
    readPowerStatus: async () => ({ batteryPercent: 80, source: "termux" }),
    runtimeGuard: async () => ({ ok: true }),
    queue: memoryQueue(),
  })
  await expect(businessman.handleTask("build")).rejects.toThrow("boom")
  expect(calls).toEqual(expect.arrayContaining(["lock", "unlock", "NEXUS task failed"]))
})

test("aborts before execution when required workers fail to install instead of reporting success", async () => {
  const calls: string[] = []
  const staff = {
    brain: { analyze: () => taskPlan, matchFreelancers: () => ["broken"] },
    hire: { hire: async () => ({ success: false, sizeMB: 0 }) },
    fire: { fireMany: async () => 0 },
  } as unknown as StaffManager
  const queue = memoryQueue()
  const businessman = new Businessman({
    staff,
    services: {
      acquireWakeLock: async () => { calls.push("lock") },
      releaseWakeLock: async () => { calls.push("unlock") },
      notify: async (title: string) => { calls.push(title) },
      toast: async () => {},
    },
    toolAgent: { execute: async () => ({}) },
    debugAgent: { execute: async () => ({}) },
    readPowerStatus: async () => ({ batteryPercent: 80, source: "termux" }),
    runtimeGuard: async () => ({ ok: true }),
    queue,
  })
  await expect(businessman.handleTask("build")).rejects.toThrow(/dependency installation failed/)
  expect(calls).not.toContain("NEXUS task completed")
  expect(queue.updates.at(-1)?.state).toBe("failed")
})

test("crash recovery marks stale accepted records failed exactly once per process", async () => {
  const queue = recoveryQueue([staleRecord()])
  const businessman = new Businessman({
    staff: staffStub(),
    services: healthyServices(),
    botAgent: { execute: async () => ({}) },
    debugAgent: { execute: async () => ({}) },
    readPowerStatus: async () => ({ source: "unavailable" }),
    runtimeGuard: async () => ({ ok: true }),
    queue,
  })
  await businessman.handleTask("fresh build")
  expect(queue.updates[0]).toEqual({ id: "job-stale", state: "failed", error: "interrupted by restart" })
  expect(queue.accepted[0]?.id).toMatch(/^job-/)
  // The second task must not re-run the recovery scan for the same records.
  await businessman.handleTask("second build")
  expect(queue.updates.filter((update) => update.id === "job-stale")).toHaveLength(1)
})

test("resumePending re-dispatches the original task text and carries the attempt counter forward", async () => {
  const executed: string[] = []
  const queue = recoveryQueue([staleRecord({ state: "failed", error: "interrupted by restart", attempts: 1 })])
  const businessman = new Businessman({
    staff: staffStub(),
    services: healthyServices(),
    botAgent: { execute: async (command: string) => { executed.push(command); return {} } },
    debugAgent: { execute: async () => ({}) },
    readPowerStatus: async () => ({ source: "unavailable" }),
    runtimeGuard: async () => ({ ok: true }),
    queue,
  })
  const outcomes = await businessman.resumePending()
  expect(executed).toEqual(["build the old thing"])
  expect(outcomes).toHaveLength(1)
  expect(outcomes[0]?.action).toBe("resumed")
  expect(outcomes[0]?.attempts).toBe(2)
  expect(outcomes[0]?.jobId).toBe(queue.accepted[0]?.id)
  expect(queue.accepted[0]?.attempts).toBe(2)
  expect(queue.updates.some((update) => update.state === "completed")).toBe(true)
})

test("resumePending refuses records that reached the lifetime attempt cap", async () => {
  const executed: string[] = []
  const record = staleRecord({ state: "failed", error: "interrupted by restart", attempts: 3 })
  const queue = recoveryQueue([record])
  const businessman = new Businessman({
    staff: staffStub(),
    services: healthyServices(),
    botAgent: { execute: async (command: string) => { executed.push(command); return {} } },
    debugAgent: { execute: async () => ({}) },
    readPowerStatus: async () => ({ source: "unavailable" }),
    runtimeGuard: async () => ({ ok: true }),
    queue,
  })
  const outcomes = await businessman.resumePending()
  expect(executed).toEqual([])
  expect(queue.accepted).toEqual([])
  expect(outcomes[0]?.action).toBe("skipped")
  expect(outcomes[0]?.reason).toMatch(/attempt limit/)
  expect(queue.updates.at(-1)?.error).toMatch(/attempt limit of 3 reached/)
})

test("runtime guard trips mid-hire loop, fails the record with an actionable reason, and stops the rest", async () => {
  const hired: string[] = []
  const calls: string[] = []
  let checks = 0
  const queue = memoryQueue()
  const businessman = new Businessman({
    staff: staffStub(["alpha", "beta"], hired),
    services: {
      acquireWakeLock: async () => {},
      releaseWakeLock: async () => { calls.push("unlock") },
      notify: async (title: string) => { calls.push(title) },
      toast: async () => {},
    },
    botAgent: { execute: async () => ({}) },
    debugAgent: { execute: async () => ({}) },
    readPowerStatus: async () => ({ batteryPercent: 12, source: "termux" }),
    runtimeGuard: async () => {
      checks += 1
      return checks === 1 ? { ok: true } : { ok: false, reason: "battery is at 9% (below 15%) and not charging; connect power and resume the task" }
    },
    queue,
  })
  await expect(businessman.handleTask("big build")).rejects.toThrow(/device guard.*battery/i)
  expect(hired).toEqual(["alpha"])
  const lastUpdate = (queue as any).updates.at(-1)
  expect(lastUpdate?.state).toBe("failed")
  expect(lastUpdate?.error).toMatch(/connect power/)
  expect(calls).toContain("unlock")
  expect(calls).toContain("NEXUS task failed")
})
