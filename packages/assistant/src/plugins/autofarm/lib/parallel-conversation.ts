// parallel-conversation: the agent and the user share a single channel,
// but the BACKGROUND task and the FOREGROUND conversation run in
// separate "lanes". The user can talk to the agent at any time, even
// while a long task is in progress; the agent can also "ping" the user
// with a status update without blocking the user from sending more
// input.
//
// Lanes:
//   FOREGROUND  — interactive, every user message is awaited here
//   BACKGROUND  — long tasks, yields cooperatively (interruptible-task)
//   PROGRESS    — throttled "X/Y done" lines (priority-router)
//
// Coordination rules:
//   1. While the FOREGROUND turn is active, BACKGROUND tasks PAUSE.
//   2. While a user message is "in flight" (between send and reply),
//      the BACKGROUND lane suppresses PROGRESS messages.
//   3. When the user is silent for `idleResumeMs`, BACKGROUND resumes.
//
// Exposes:
//   chat.send(text)   — user types, returns reply promise
//   chat.notify(text) — agent speaks without expecting reply
//   chat.taskStart(name, runner) — schedule a long task

import { EventEmitter } from "node:events"
import { log } from "./logger.ts"
import { InterruptibleTask, pauseAll, resumeAll, listRunningTasks } from "./interruptible-task.ts"
import { emit, recent, recentUser, userMsg } from "./priority-router.ts"
import { tryShortReply, buildShortReply } from "./short-reply-mode.ts"

export interface ChatOptions {
  /** Reply function. Async, may take seconds. */
  reply: (text: string, ctx: ChatContext) => Promise<string>
  /** How long to wait for the user to go silent before resuming bg tasks. */
  idleResumeMs?: number
  /** Optional: list of "intents" that should NOT pause bg (e.g. "?"). */
  noPauseIntents?: string[]
}

export interface ChatContext {
  /** True if there's at least one bg task currently paused for this turn. */
  pausedBg: string[]
  /** Recent user messages (most recent first). */
  recentUser: string[]
  /** Recent progress messages. */
  recentProgress: string[]
  /** Whether the user appears idle. */
  userIdle: boolean
}

export interface ChatHandle {
  send(text: string): Promise<string>
  notify(text: string): void
  taskStart(name: string, runner: (yieldFn: () => Promise<void>) => Promise<void>): InterruptibleTask
  on(event: "send" | "reply" | "taskStart" | "taskEnd" | "userIdle", cb: (...args: unknown[]) => void): void
  close(): Promise<void>
  status(): { idle: boolean; lastUserMsg: string | null; bgTasks: number; paused: number }
}

export function createChat(opts: ChatOptions): ChatHandle {
  const bus = new EventEmitter()
  const noPause = new Set(opts.noPauseIntents ?? ["help", "status", "next", "thanks"])
  let lastUserAt = 0
  let lastReplyAt = 0
  let currentTask: InterruptibleTask | null = null
  let closed = false
  const idleResumeMs = opts.idleResumeMs ?? 1500

  // Idle watcher: every 500ms, if no user msg for `idleResumeMs`, resume bg
  setInterval(() => {
    if (closed) return
    if (Date.now() - lastUserAt < idleResumeMs) return
    if (Date.now() - lastReplyAt < idleResumeMs) return
    if (listRunningTasks().some((t) => t.isPaused())) {
      const r = resumeAll()
      if (r.length > 0) {
        bus.emit("userIdle")
        emit(20, "chat", `↩  background resumed (${r.length} task(s))`)
      }
    }
  }, 500).unref()

  async function send(text: string): Promise<string> {
    if (closed) return "(chat closed)"
    lastUserAt = Date.now()
    bus.emit("send", text)
    userMsg(text)
    const ctx: ChatContext = {
      pausedBg: [],
      recentUser: recentUser(5).map((m) => m.text),
      recentProgress: recent(20).filter((m) => m.bucket === 40).map((m) => m.text),
      userIdle: false,
    }
    // 1) Try short-reply first (sub-100ms path)
    const short = tryShortReply(text)
    if (short) {
      // Don't pause bg for "?", "status", "next", "thanks"
      const needsPause = !noPause.has(short.intent)
      let paused: InterruptibleTask[] = []
      if (needsPause) paused = pauseAll("user short-reply: " + short.intent)
      ctx.pausedBg = paused.map((t) => t.name)
      // Wait a beat so the user "sees" the reply settle
      await new Promise((r) => setTimeout(r, 30))
      lastReplyAt = Date.now()
      emit(80, "agent", short.reply, { intent: short.intent, short: true })
      bus.emit("reply", short.reply, true)
      if (needsPause) {
        setTimeout(() => {
          if (listRunningTasks().every((t) => t.isPaused())) resumeAll()
        }, idleResumeMs)
      }
      return short.reply
    }
    // 2) Long path: pause bg, call the LLM-backed reply(), resume bg after.
    const paused = pauseAll("user message")
    ctx.pausedBg = paused.map((t) => t.name)
    let reply = ""
    try {
      reply = await opts.reply(text, ctx)
    } catch (e) {
      log.error("chat", `reply failed: ${(e as Error).message}`)
      reply = `[!] error: ${(e as Error).message}`
    }
    lastReplyAt = Date.now()
    emit(80, "agent", reply, { short: false })
    bus.emit("reply", reply, false)
    // After idleResumeMs of silence, resume bg
    setTimeout(() => {
      if (Date.now() - lastReplyAt >= idleResumeMs) {
        if (listRunningTasks().some((t) => t.isPaused())) {
          resumeAll()
          bus.emit("userIdle")
        }
      }
    }, idleResumeMs)
    return reply
  }

  function notify(text: string): void {
    emit(60, "agent", text, { notify: true })
    bus.emit("reply", text, false)
  }

  function taskStart(name: string, runner: (yieldFn: () => Promise<void>) => Promise<void>): InterruptibleTask {
    const t = new InterruptibleTask(`task-${Date.now()}`, name)
    t.start(runner)
    bus.emit("taskStart", name, t)
    emit(40, "agent", `[>] started: ${name}`)
    return t
  }

  function status() {
    const tasks = listRunningTasks()
    return {
      idle: Date.now() - lastUserAt > idleResumeMs,
      lastUserMsg: recentUser(1)[0]?.text ?? null,
      bgTasks: tasks.length,
      paused: tasks.filter((t) => t.isPaused()).length,
    }
  }

  async function close() {
    closed = true
    for (const t of listRunningTasks()) await t.cancel()
  }

  function on(event: "send" | "reply" | "taskStart" | "taskEnd" | "userIdle", cb: (...args: unknown[]) => void) {
    bus.on(event, cb as (...a: unknown[]) => void)
  }

  return { send, notify, taskStart, on, close, status }
}
