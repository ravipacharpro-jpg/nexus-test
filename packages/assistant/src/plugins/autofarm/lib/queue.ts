// Task queue for NEXUS autofarm
// Enables async background jobs with retry, timeout, and priority.
//
// Why: NEXUS is a long-running service. Users need to queue multiple
// tasks (e.g. "create 5 gmails then farm 3 providers") and have them
// processed sequentially with persistence across restarts.
//
// Usage:
//   import { taskQueue } from "./lib/queue.ts"
//   const id = taskQueue.push({
//     type: "create-gmail",
//     priority: 5,
//     payload: { count: 3 },
//   })
//   taskQueue.run(async (task) => { ... return { ok: true } })
//   taskQueue.status()

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { log } from "./logger.ts"

export type TaskType =
  | "create-gmail"
  | "farm-provider"
  | "verify-key"
  | "extract-keys"
  | "fix-broken"
  | "scan-local-llm"
  | "rotate-key"
  | "compress-vault"
  | "encrypt-vault"
  | "decrypt-vault"
  | "send-webhook"
  | "custom"

export type TaskStatus = "queued" | "running" | "done" | "failed" | "cancelled" | "timeout"

export interface Task {
  id: string
  type: TaskType
  priority: number // higher = more important
  payload: Record<string, unknown>
  status: TaskStatus
  attempts: number
  maxAttempts: number
  timeoutMs: number
  createdAt: number
  startedAt?: number
  finishedAt?: number
  result?: unknown
  error?: string
  /** ISO timestamp for next retry (if failed) */
  nextRetryAt?: number
}

const STORE_DIR = path.join(os.homedir(), ".nexus", "autofarm", "queue")
const STORE_FILE = path.join(STORE_DIR, "tasks.jsonl")

type Handler = (task: Task) => Promise<{ ok: boolean; result?: unknown; error?: string }>

let handler: Handler | null = null
let running = false
let stopFlag = false
let activeLoop: ReturnType<typeof setTimeout> | null = null

function nextId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function ensureDir(): void {
  try { fs.mkdirSync(STORE_DIR, { recursive: true }) } catch {}
}

function persist(tasks: Task[]): void {
  ensureDir()
  try { fs.writeFileSync(STORE_FILE, tasks.map((t) => JSON.stringify(t)).join("\n") + "\n") } catch (e) {
    log.warn("queue", `persist failed: ${(e as Error).message}`)
  }
}

function load(): Task[] {
  try {
    if (!fs.existsSync(STORE_FILE)) return []
    return fs.readFileSync(STORE_FILE, "utf8")
      .split(/\r?\n/).filter(Boolean)
      .map((l) => { try { return JSON.parse(l) as Task } catch { return null } })
      .filter((t): t is Task => Boolean(t))
  } catch { return [] }
}

export const taskQueue = {
  push(input: { type: TaskType; payload?: Record<string, unknown>; priority?: number; maxAttempts?: number; timeoutMs?: number }): Task {
    const tasks = load()
    const task: Task = {
      id: nextId(),
      type: input.type,
      priority: input.priority ?? 5,
      payload: input.payload ?? {},
      status: "queued",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 1,
      timeoutMs: input.timeoutMs ?? 5 * 60_000,
      createdAt: Date.now(),
    }
    tasks.push(task)
    persist(tasks)
    log.info("queue", `push ${task.type} id=${task.id} pri=${task.priority}`)
    return task
  },

  list(): Task[] {
    return load().sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
  },

  pending(): Task[] {
    return this.list().filter((t) => t.status === "queued" || t.status === "running")
  },

  get(id: string): Task | null {
    return load().find((t) => t.id === id) ?? null
  },

  cancel(id: string): boolean {
    const tasks = load()
    const t = tasks.find((x) => x.id === id)
    if (!t || t.status === "done" || t.status === "failed") return false
    t.status = "cancelled"
    t.finishedAt = Date.now()
    persist(tasks)
    return true
  },

  clear(): void {
    persist([])
  },

  setHandler(h: Handler): void { handler = h },

  isRunning(): boolean { return running },

  /** Start the consumer loop. Idempotent. */
  async run(h?: Handler): Promise<void> {
    if (running) return
    if (h) handler = h
    if (!handler) throw new Error("no handler set; call setHandler first")
    running = true
    stopFlag = false
    log.info("queue", "started")
    while (!stopFlag) {
      const task = this.claimNext()
      if (!task) {
        // idle, wait 1s
        await new Promise((r) => setTimeout(r, 1000))
        continue
      }
      await this.execute(task)
    }
    running = false
    log.info("queue", "stopped")
  },

  async runOnce(): Promise<Task | null> {
    const task = this.claimNext()
    if (!task) return null
    await this.execute(task)
    return task
  },

  stop(): void {
    stopFlag = true
    if (activeLoop) clearTimeout(activeLoop)
  },

  claimNext(): Task | null {
    const tasks = load()
    const candidates = tasks
      .filter((t) => t.status === "queued" || (t.status === "failed" && (t.nextRetryAt ?? 0) <= Date.now() && t.attempts < t.maxAttempts))
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
    const next = candidates[0]
    if (!next) return null
    next.status = "running"
    next.startedAt = Date.now()
    next.attempts++
    persist(tasks)
    return next
  },

  async execute(task: Task): Promise<void> {
    if (!handler) return
    log.info("queue", `exec ${task.type} id=${task.id} attempt=${task.attempts}/${task.maxAttempts}`)
    try {
      const result = await withTimeout(handler(task), task.timeoutMs, () => {
        const err = new Error(`timeout after ${task.timeoutMs}ms`)
        return Promise.reject(err)
      })
      const tasks = load()
      const t = tasks.find((x) => x.id === task.id)
      if (t) {
        t.status = result.ok ? "done" : "failed"
        t.finishedAt = Date.now()
        t.result = result.result
        if (!result.ok) t.error = result.error
        persist(tasks)
      }
      if (result.ok) log.ok("queue", `${task.type} done`)
      else log.warn("queue", `${task.type} failed: ${result.error}`)
    } catch (e) {
      const tasks = load()
      const t = tasks.find((x) => x.id === task.id)
      if (t) {
        t.status = (e as Error).message.includes("timeout") ? "timeout" : "failed"
        t.finishedAt = Date.now()
        t.error = (e as Error).message
        // exponential backoff: 30s, 2m, 8m, 30m, capped
        const backoff = Math.min(30 * 60_000, 30_000 * Math.pow(4, t.attempts - 1))
        t.nextRetryAt = Date.now() + backoff
        persist(tasks)
      }
      log.error("queue", `${task.type} error: ${(e as Error).message}`)
    }
  },

  status(): { running: boolean; pending: number; done: number; failed: number; byType: Record<string, number> } {
    const tasks = load()
    const pending = tasks.filter((t) => t.status === "queued" || t.status === "running").length
    const done = tasks.filter((t) => t.status === "done").length
    const failed = tasks.filter((t) => t.status === "failed" || t.status === "timeout").length
    const byType: Record<string, number> = {}
    for (const t of tasks) byType[t.type] = (byType[t.type] ?? 0) + 1
    return { running, pending, done, failed, byType }
  },

  path(): string { return STORE_FILE },
}

async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => onTimeout().then(resolve).catch(reject), ms)
    promise.then((v) => { clearTimeout(timer); resolve(v) }, (e) => { clearTimeout(timer); reject(e) })
  })
}
