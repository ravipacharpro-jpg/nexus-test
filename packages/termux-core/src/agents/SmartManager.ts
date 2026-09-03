import { existsSync, readFileSync } from "node:fs"
import { mkdir, rename, writeFile } from "node:fs/promises"
import { homedir, totalmem } from "node:os"
import { join } from "node:path"

const GIB = 1024 * 1024 * 1024

export type DeviceKind = "PC" | "Termux"
export type CapacityMode = "low" | "medium" | "high"

export type CapacityPlan = {
  device: DeviceKind
  mode: CapacityMode
  totalMemoryBytes: number
  availableMemoryBytes?: number
  processMemoryBytes: number
  maxParallel: number
  leadCount: number
  workersPerLead: number
  workerTaskCount: number
}

export type CapacityProbe = {
  isTermux?: boolean
  totalMemoryBytes?: number
  processMemoryBytes?: number
  meminfo?: string
}

export type PersistedTaskState = "accepted" | "running" | "paused" | "cancelled" | "completed" | "failed"
export type TaskControlAction = "pause" | "cancel" | "update" | "resume"

export const INTERRUPTED_BY_RESTART = "interrupted by restart"
export const MAX_TASK_ATTEMPTS = 3

export type TaskControl = {
  action: TaskControlAction
  instruction?: string
  requestedAt: number
}

export class TaskControlInterruption extends Error {
  constructor(readonly action: "pause" | "cancel") {
    super(action === "pause" ? "Task paused by user." : "Task cancelled by user.")
    this.name = "TaskControlInterruption"
  }
}

export type PersistedTask = {
  id: string
  task: string
  root: string
  state: PersistedTaskState
  capacity: CapacityPlan
  createdAt: number
  updatedAt: number
  error?: string
  control?: TaskControl
  /** Dispatch count including the current run; absent in queue files written before crash recovery existed. */
  attempts?: number
}

type TaskStore = {
  version: 1
  tasks: PersistedTask[]
}

function readMeminfoValue(meminfo: string, key: "MemTotal" | "MemAvailable") {
  const match = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB$`, "m"))
  return match ? Number(match[1]) * 1024 : undefined
}

function isTermuxRuntime() {
  return Boolean(process.env.TERMUX_VERSION || process.env.PREFIX?.includes("com.termux"))
}

function systemMemoryBytes() {
  return process.platform === "linux" && existsSync("/proc/meminfo")
    ? readMeminfoValue(readFileSync("/proc/meminfo", "utf8"), "MemTotal")
    : undefined
}

function systemAvailableMemoryBytes() {
  return process.platform === "linux" && existsSync("/proc/meminfo")
    ? readMeminfoValue(readFileSync("/proc/meminfo", "utf8"), "MemAvailable")
    : undefined
}

type StoredTaskProfile = "fast" | "balanced" | "deep" | "local"

function configuredTaskProfile(): StoredTaskProfile | undefined {
  try {
    const raw = JSON.parse(
      readFileSync(process.env.NEXUS_TASK_PROFILE_PATH || join(homedir(), ".nexus", "task-profile.json"), "utf8"),
    ) as { profile?: unknown }
    if (raw.profile === "fast" || raw.profile === "balanced" || raw.profile === "deep" || raw.profile === "local") return raw.profile
  } catch {}
  return undefined
}

function applyTaskProfile(plan: CapacityPlan, profile = configuredTaskProfile()): CapacityPlan {
  if (!profile || profile === "deep") return plan
  const maxParallel = Math.min(plan.maxParallel, profile === "balanced" ? 3 : 2)
  const leadCount = 1
  const workersPerLead = Math.max(1, maxParallel - 1)
  return { ...plan, maxParallel, leadCount, workersPerLead, workerTaskCount: leadCount * workersPerLead }
}

export function detectCapacity(probe: CapacityProbe = {}): CapacityPlan {
  const device: DeviceKind = probe.isTermux ?? isTermuxRuntime() ? "Termux" : "PC"
  const meminfo = probe.meminfo
  const totalMemoryBytes = probe.totalMemoryBytes
    ?? (meminfo ? readMeminfoValue(meminfo, "MemTotal") : undefined)
    ?? systemMemoryBytes()
    ?? totalmem()
  const availableMemoryBytes = meminfo ? readMeminfoValue(meminfo, "MemAvailable") : systemAvailableMemoryBytes()
  const processMemoryBytes = probe.processMemoryBytes ?? process.memoryUsage().rss
  const memoryGiB = totalMemoryBytes / GIB
  const availableGiB = (availableMemoryBytes ?? Math.max(totalMemoryBytes - processMemoryBytes, 0)) / GIB

  let mode: CapacityMode
  if (device === "Termux") {
    mode = memoryGiB <= 3 || availableGiB < 1.25 ? "low" : memoryGiB < 8 ? "medium" : "high"
  } else {
    mode = memoryGiB >= 12 && availableGiB >= 2 ? "high" : memoryGiB >= 6 ? "medium" : "low"
  }

  const budget = mode === "high"
    ? { maxParallel: 12, leadCount: 4, workersPerLead: 3 }
    : mode === "medium"
      ? { maxParallel: 6, leadCount: 2, workersPerLead: 3 }
      : { maxParallel: 3, leadCount: 1, workersPerLead: 2 }

  return applyTaskProfile({
    device,
    mode,
    totalMemoryBytes,
    availableMemoryBytes,
    processMemoryBytes,
    ...budget,
    workerTaskCount: budget.leadCount * budget.workersPerLead,
  })
}

export function formatDeviceMode(capacity: CapacityPlan) {
  const memoryGiB = Math.max(1, Math.round(capacity.totalMemoryBytes / GIB))
  return `Device: ${capacity.device} (${memoryGiB}GB) → ${capacity.mode.toUpperCase()} mode`
}

export class PersistentTaskQueue {
  constructor(readonly path = process.env.NEXUS_QUEUE_PATH || join(homedir(), ".nexus", "queue.json")) {}

  async list(): Promise<PersistedTask[]> {
    return (await this.read()).tasks
  }

  async upsert(task: PersistedTask) {
    const store = await this.read()
    const index = store.tasks.findIndex((item) => item.id === task.id)
    if (index === -1) store.tasks.push(task)
    else store.tasks[index] = task
    await this.write(store)
    return task
  }

  private async read(): Promise<TaskStore> {
    try {
      const raw = await readFileSafe(this.path)
      if (!raw) return { version: 1, tasks: [] }
      const parsed = JSON.parse(raw) as Partial<TaskStore>
      return parsed.version === 1 && Array.isArray(parsed.tasks) ? { version: 1, tasks: parsed.tasks } : { version: 1, tasks: [] }
    } catch {
      return { version: 1, tasks: [] }
    }
  }

  private async write(store: TaskStore) {
    await mkdir(join(this.path, ".."), { recursive: true })
    const temporaryPath = `${this.path}.${process.pid}.tmp`
    await writeFile(temporaryPath, JSON.stringify(store, null, 2) + "\n", "utf8")
    await rename(temporaryPath, this.path)
  }
}

async function readFileSafe(path: string) {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

export class SmartManager {
  constructor(
    private readonly taskStore = new PersistentTaskQueue(),
    private readonly capacityProbe?: CapacityProbe,
  ) {}

  get capacity() {
    return detectCapacity(this.capacityProbe)
  }

  async accept(id: string, task: string, root: string, capacity = this.capacity, attempts = 1) {
    const now = Date.now()
    return this.taskStore.upsert({ id, task, root, capacity, state: "accepted", attempts, createdAt: now, updatedAt: now })
  }

  async update(id: string, state: PersistedTaskState, error?: string) {
    const tasks = await this.taskStore.list()
    const current = tasks.find((task) => task.id === id)
    if (!current) return undefined
    return this.taskStore.upsert({ ...current, state, error, updatedAt: Date.now() })
  }

  // "paused" is deliberately excluded: pausing is a user decision that must survive restarts.
  async stalePending(before: number) {
    return (await this.taskStore.list()).filter((task) =>
      (task.state === "accepted" || task.state === "running") && task.updatedAt < before)
  }

  async task(id: string) {
    return (await this.taskStore.list()).find((item) => item.id === id)
  }

  async list() {
    return this.taskStore.list()
  }

  async control(id: string, action: TaskControlAction, instruction?: string) {
    const current = await this.task(id)
    if (!current) return undefined
    const state: PersistedTaskState = action === "pause" ? "paused" : action === "cancel" ? "cancelled" : action === "resume" ? "accepted" : current.state
    return this.taskStore.upsert({
      ...current,
      state,
      control: { action, instruction: instruction?.trim() || undefined, requestedAt: Date.now() },
      updatedAt: Date.now(),
    })
  }

  async consumeControl(id: string) {
    const current = await this.task(id)
    if (!current?.control) return undefined
    const control = current.control
    if (control.action === "cancel" || control.action === "pause") return control
    await this.taskStore.upsert({ ...current, control: undefined, updatedAt: Date.now() })
    return control
  }

  acknowledgement(capacity = this.capacity) {
    return [
      formatDeviceMode(capacity),
      `Plan: ${capacity.leadCount} lead(s), ${capacity.workerTaskCount} worker task(s), max ${capacity.maxParallel} active slot(s).`,
      "Manager accepted the task and started the workflow.",
    ].join("\n")
  }
}

export default SmartManager
