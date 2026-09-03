// interruptible-task: a long-running task that can be safely PAUSED
// when a user message arrives, then RESUMED seamlessly. Designed for
// the case where a background pipeline (Gmail farm, OpenRouter signup)
// takes 30-120s and the user is impatient.
//
// The cooperative pause point is `await checkPause()` which the
// long task should sprinkle inside its hot loop. Total pause overhead
// is <50ms; resume is automatic.
//
// Pattern:
//
//   const t = new InterruptibleTask("create-gmail", async (yield) => {
//     for (let i = 0; i < 10; i++) {
//       await yield()              // cooperative pause
//       await doWork(i)
//     }
//   })
//   t.start()
//   // later, on user message:
//   t.pause("user asked a question")
//   // after handling the user msg:
//   t.resume()

import { EventEmitter } from "node:events"
import { log } from "./logger.ts"

export type TaskState = "idle" | "running" | "paused" | "done" | "failed" | "cancelled"

export interface InterruptOptions {
  /** Max ms to wait at a pause point before auto-resuming (default 30s). */
  pauseTimeoutMs?: number
  /** Polling interval for the pause check (default 100ms). */
  pollMs?: number
}

export class InterruptibleTask extends EventEmitter {
  readonly id: string
  readonly name: string
  state: TaskState = "idle"
  private pauseResolvers: Array<() => void> = []
  private pauseReason: string | null = null
  private pauseStartedAt = 0
  private pauseTimeoutMs: number
  private pollMs: number
  private autoResumeHandle: ReturnType<typeof setTimeout> | null = null
  private taskPromise: Promise<void> | null = null
  private startTime = 0

  constructor(id: string, name: string, opts: InterruptOptions = {}) {
    super()
    this.id = id
    this.name = name
    this.pauseTimeoutMs = opts.pauseTimeoutMs ?? 30_000
    this.pollMs = opts.pollMs ?? 100
  }

  /** Start the task. `runner` receives a `yield()` function it must
   *  call inside its loop to allow pausing. */
  start(runner: (yieldFn: () => Promise<void>) => Promise<void>): void {
    if (this.taskPromise) return
    this.state = "running"
    this.startTime = Date.now()
    const yieldFn = (): Promise<void> => this.checkPause()
    this.taskPromise = runner(yieldFn)
      .then(() => {
        this.state = "done"
        this.emit("done", { id: this.id, ms: Date.now() - this.startTime })
      })
      .catch((e) => {
        if (this.state === "cancelled") {
          this.emit("cancelled", { id: this.id })
        } else {
          this.state = "failed"
          this.emit("failed", { id: this.id, error: (e as Error).message })
          log.error("itask", `${this.name} failed: ${(e as Error).message}`)
        }
      })
  }

  /** Pause at the next `yield()` checkpoint. Returns immediately. */
  pause(reason = "user interaction"): void {
    if (this.state !== "running") return
    this.pauseReason = reason
    this.pauseStartedAt = Date.now()
    this.state = "paused"
    log.info("itask", `${this.name} paused (${reason})`)
    this.emit("paused", { id: this.id, reason })
    // Auto-resume if nobody resumes manually
    if (this.autoResumeHandle) clearTimeout(this.autoResumeHandle)
    this.autoResumeHandle = setTimeout(() => {
      if (this.state === "paused") {
        log.warn("itask", `${this.name} auto-resuming after ${this.pauseTimeoutMs}ms`)
        this.resume()
      }
    }, this.pauseTimeoutMs)
  }

  /** Resume a paused task. Resolves any pending `yield()` calls. */
  resume(): void {
    if (this.state !== "paused") return
    if (this.autoResumeHandle) {
      clearTimeout(this.autoResumeHandle)
      this.autoResumeHandle = null
    }
    const duration = Date.now() - this.pauseStartedAt
    this.state = "running"
    this.pauseReason = null
    this.pauseStartedAt = 0
    log.info("itask", `${this.name} resumed (was paused ${duration}ms)`)
    this.emit("resumed", { id: this.id, pausedMs: duration })
    const resolvers = this.pauseResolvers
    this.pauseResolvers = []
    for (const r of resolvers) r()
  }

  /** Cancel a running or paused task. */
  async cancel(): Promise<void> {
    if (this.state === "done" || this.state === "failed" || this.state === "cancelled") return
    this.state = "cancelled"
    // Release any pending pause so the runner can exit cleanly
    this.resume()
    try {
      await this.taskPromise
    } catch {
      /* swallow — cancel is not a "failure" */
    }
  }

  /** Called from inside the runner. Blocks if the task is paused. */
  private async checkPause(): Promise<void> {
    if (this.state !== "paused") return
    await new Promise<void>((resolve) => this.pauseResolvers.push(resolve))
  }

  /** Public version of yield() so external callers can wait. */
  async yield(): Promise<void> {
    return this.checkPause()
  }

  isPaused(): boolean { return this.state === "paused" }
  isRunning(): boolean { return this.state === "running" }
  isDone(): boolean { return this.state === "done" || this.state === "failed" || this.state === "cancelled" }
  getPauseReason(): string | null { return this.pauseReason }
  getElapsedMs(): number { return this.startTime ? Date.now() - this.startTime : 0 }
}

/** Registry of all running tasks so the conversation layer can pause them. */
const REGISTRY = new Map<string, InterruptibleTask>()

export function registerTask(t: InterruptibleTask): void {
  REGISTRY.set(t.id, t)
}

export function unregisterTask(id: string): void {
  REGISTRY.delete(id)
}

export function getTask(id: string): InterruptibleTask | undefined {
  return REGISTRY.get(id)
}

export function listRunningTasks(): InterruptibleTask[] {
  return [...REGISTRY.values()].filter((t) => t.isRunning() || t.isPaused())
}

/** Convenience: pause every running task. Used when a user message arrives. */
export function pauseAll(reason = "user message"): InterruptibleTask[] {
  const paused: InterruptibleTask[] = []
  for (const t of REGISTRY.values()) {
    if (t.isRunning()) {
      t.pause(reason)
      paused.push(t)
    }
  }
  return paused
}

/** Convenience: resume every paused task. */
export function resumeAll(): InterruptibleTask[] {
  const resumed: InterruptibleTask[] = []
  for (const t of REGISTRY.values()) {
    if (t.isPaused()) {
      t.resume()
      resumed.push(t)
    }
  }
  return resumed
}
