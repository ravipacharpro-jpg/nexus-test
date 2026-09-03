import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { DualWorkerPool } from "./DualWorkerPool"
import { PersistentTaskQueue, SmartManager, detectCapacity, formatDeviceMode } from "./SmartManager"
import { UserLiaison } from "./UserLiaison"

const GIB = 1024 * 1024 * 1024

function meminfo(totalGiB: number, availableGiB: number) {
  return `MemTotal:       ${totalGiB * 1024 * 1024} kB\nMemAvailable:   ${availableGiB * 1024 * 1024} kB\n`
}

test("detects a lightweight Termux plan with three total active slots", () => {
  const plan = detectCapacity({
    isTermux: true,
    totalMemoryBytes: 2 * GIB,
    processMemoryBytes: 180 * 1024 * 1024,
    meminfo: meminfo(2, 1),
  })
  assert.deepEqual(
    { device: plan.device, mode: plan.mode, maxParallel: plan.maxParallel, leadCount: plan.leadCount, workerTaskCount: plan.workerTaskCount },
    { device: "Termux", mode: "low", maxParallel: 3, leadCount: 1, workerTaskCount: 2 },
  )
  assert.equal(formatDeviceMode(plan), "Device: Termux (2GB) → LOW mode")
})

test("detects a desktop high plan with twelve total active slots", () => {
  const plan = detectCapacity({
    isTermux: false,
    totalMemoryBytes: 16 * GIB,
    processMemoryBytes: 512 * 1024 * 1024,
    meminfo: meminfo(16, 14),
  })
  assert.deepEqual(
    { device: plan.device, mode: plan.mode, maxParallel: plan.maxParallel, leadCount: plan.leadCount, workerTaskCount: plan.workerTaskCount },
    { device: "PC", mode: "high", maxParallel: 12, leadCount: 4, workerTaskCount: 12 },
  )
  assert.equal(formatDeviceMode(plan), "Device: PC (16GB) → HIGH mode")
})

test("an explicit Fast task profile caps capacity without changing the default device tier", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexus-task-profile-"))
  const profilePath = join(root, "task-profile.json")
  const previousProfilePath = process.env.NEXUS_TASK_PROFILE_PATH
  process.env.NEXUS_TASK_PROFILE_PATH = profilePath
  try {
    await writeFile(profilePath, JSON.stringify({ version: 1, profile: "fast" }), "utf8")
    const plan = detectCapacity({ isTermux: false, totalMemoryBytes: 16 * GIB, processMemoryBytes: 0, meminfo: meminfo(16, 14) })
    assert.deepEqual(
      { maxParallel: plan.maxParallel, leadCount: plan.leadCount, workerTaskCount: plan.workerTaskCount },
      { maxParallel: 2, leadCount: 1, workerTaskCount: 1 },
    )
  } finally {
    if (previousProfilePath === undefined) delete process.env.NEXUS_TASK_PROFILE_PATH
    else process.env.NEXUS_TASK_PROFILE_PATH = previousProfilePath
    await rm(root, { recursive: true, force: true })
  }
})

test("DualWorkerPool accounts for every active slot and never exceeds its cap", async () => {
  const pool = new DualWorkerPool(3)
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => { release = resolve })
  const work = Array.from({ length: 6 }, () => pool.execute(async () => gate))
  await Promise.resolve()
  assert.deepEqual(pool.snapshot, { maxParallel: 3, activeWorkers: 3, pendingWorkers: 3 })
  release()
  await Promise.all(work)
  assert.deepEqual(pool.snapshot, { maxParallel: 3, activeWorkers: 0, pendingWorkers: 0 })
})

test("persistent task records survive a new queue instance", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexus-smart-manager-"))
  const path = join(root, "queue.json")
  try {
    const queue = new PersistentTaskQueue(path)
    const manager = new SmartManager(queue)
    const capacity = detectCapacity({ isTermux: true, totalMemoryBytes: 2 * GIB, processMemoryBytes: 0, meminfo: meminfo(2, 1) })
    await manager.accept("task-1", "big task", root, capacity)
    await manager.update("task-1", "running")
    const reloaded = new PersistentTaskQueue(path)
    const tasks = await reloaded.list()
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]?.state, "running")
    const raw = JSON.parse(await readFile(path, "utf8")) as { version: number }
    assert.equal(raw.version, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("crash recovery scans only non-terminal records older than the cutoff and keeps legacy files loadable", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexus-crash-recovery-"))
  const path = join(root, "queue.json")
  try {
    // Legacy record shape: no attempts field, written before crash recovery existed.
    const legacy = { id: "legacy", task: "old task", root, state: "accepted", capacity: {}, createdAt: 1, updatedAt: 1 }
    await writeFile(path, JSON.stringify({ version: 1, tasks: [legacy] }) + "\n", "utf8")
    const manager = new SmartManager(new PersistentTaskQueue(path))
    const tasks = await manager.list()
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]?.attempts, undefined)

    const cutoff = Date.now()
    await manager.accept("fresh", "new task", root)
    assert.equal((await manager.task("fresh"))?.attempts, 1)
    await manager.accept("paused-one", "paused task", root)
    await manager.update("paused-one", "paused")
    const stale = await manager.stalePending(cutoff)
    assert.deepEqual(stale.map((task) => task.id), ["legacy"])

    await manager.accept("done", "finished task", root)
    await manager.update("done", "completed")
    assert.ok(!(await manager.stalePending(Date.now() + 10_000)).some((task) => task.id === "done"))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("user task controls persist across a fresh liaison instance and wait for a safe checkpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexus-task-control-"))
  const queuePath = join(root, "queue.json")
  const previousPath = process.env.NEXUS_QUEUE_PATH
  process.env.NEXUS_QUEUE_PATH = queuePath
  try {
    const manager = new SmartManager(new PersistentTaskQueue(queuePath))
    await manager.accept("task-control", "inspect the repository", root)
    await manager.update("task-control", "running")

    const liaison = new UserLiaison({ notify: false })
    const update = await liaison.handleUserMessage("update only inspect the API module", "test", root)
    assert.match(update, /next safe checkpoint/i)
    const paused = await liaison.handleUserMessage("pause", "test", root)
    assert.match(paused, /Pause requested/i)

    const persisted = await new PersistentTaskQueue(queuePath).list()
    assert.equal(persisted[0]?.state, "paused")
    assert.equal(persisted[0]?.control?.action, "pause")
  } finally {
    if (previousPath === undefined) delete process.env.NEXUS_QUEUE_PATH
    else process.env.NEXUS_QUEUE_PATH = previousPath
    await rm(root, { recursive: true, force: true })
  }
})

test("big task acknowledgement is immediate, reports capacity, and omits the retired waiting label", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexus-liaison-"))
  const queuePath = join(root, "queue.json")
  const previousPath = process.env.NEXUS_QUEUE_PATH
  const previousTermux = process.env.TERMUX_VERSION
  process.env.NEXUS_QUEUE_PATH = queuePath
  process.env.TERMUX_VERSION = "0.118"
  try {
    const liaison = new UserLiaison({ background: true, notify: false })
    const startedAt = Date.now()
    const acknowledgement = await liaison.handleUserMessage("big task", "test", root)
    assert.ok(Date.now() - startedAt < 250)
    assert.match(acknowledgement, /Device: Termux .* mode/)
    assert.match(acknowledgement, /max (3|6|12) active slot/)
    assert.doesNotMatch(acknowledgement, /queued/i)
    const persisted = JSON.parse(await readFile(queuePath, "utf8")) as { tasks: Array<{ id: string }> }
    assert.equal(persisted.tasks.length, 1)
    assert.match(acknowledgement, new RegExp(persisted.tasks[0]!.id))
  } finally {
    if (previousPath === undefined) delete process.env.NEXUS_QUEUE_PATH
    else process.env.NEXUS_QUEUE_PATH = previousPath
    if (previousTermux === undefined) delete process.env.TERMUX_VERSION
    else process.env.TERMUX_VERSION = previousTermux
    await rm(root, { recursive: true, force: true })
  }
})
