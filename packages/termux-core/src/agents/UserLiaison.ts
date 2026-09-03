import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { promisify } from "node:util"
import { SeniorDevAgent } from "./SeniorDevAgent"
import { ManagerAgent, type ProjectResult, type TeamStatus } from "./TeamHierarchy"
import { SmartManager, TaskControlInterruption, type CapacityProbe, type TaskControlAction } from "./SmartManager"

const execFileAsync = promisify(execFile)

export type MessageType = "greeting" | "small_talk" | "status_check" | "small_task" | "big_task" | "command" | "help" | "complaint"

export type TaskStatus = {
  taskId: string
  userId: string
  message: string
  status: string
  progress: number
  startedAt: number
  updatedAt: number
  result?: ProjectResult
  error?: string
}

export type LiaisonOptions = {
  onUpdate?: (status: TaskStatus) => void | Promise<void>
  notify?: boolean
  background?: boolean
  capacityProbe?: CapacityProbe
}

const statusRoot = join(tmpdir(), "nexus", "liaison")

export function classifyMessage(message: string): MessageType {
  const lower = message.toLowerCase().trim()
  if (/^(hi|hello|hey|hola)\b/.test(lower)) return "greeting"
  if (/^(status|progress|kahan tak|kitna hua)\b/.test(lower)) return "status_check"
  if (/^(stop|cancel|pause|resume|exit|kill|update|change|instead|priority)\b/.test(lower)) return "command"
  if (/^(help|kya kar sakte|commands|menu)\b/.test(lower)) return "help"
  if (/^(galat|error|bug|sahi nahi|fail)\b/.test(lower)) return "complaint"
  if (/^(time|date|weather|joke|batao)\b/.test(lower)) return "small_talk"
  const bigIndicators = ["big task", "refactor", "migrate", "rewrite", "architecture", "bot banao", "app banao", "repo", "project", "module"]
  return bigIndicators.some((word) => lower.includes(word)) ? "big_task" : "small_task"
}

function taskId() {
  return `liaison-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export class UserLiaison {
  private readonly activeTasks = new Map<string, TaskStatus>()
  private readonly seniorDev: SeniorDevAgent
  private readonly manager: ManagerAgent
  private readonly options: LiaisonOptions

  constructor(options: LiaisonOptions = {}) {
    this.options = options
    this.seniorDev = new SeniorDevAgent()
    this.manager = new ManagerAgent(new SmartManager(undefined, options.capacityProbe))
  }

  async handleUserMessage(message: string, userId = "local", root = "."): Promise<string> {
    const type = classifyMessage(message)
    switch (type) {
      case "greeting":
        return "Hello! What would you like to automate? Type 'help' for options."
      case "small_talk":
        return this.handleSmallTalk(message)
      case "help":
        return this.getHelpText()
      case "status_check":
        return this.getActiveTaskStatus(userId)
      case "command":
        return this.handleCommand(message, userId)
      case "complaint":
        return "Understood. Share the error or expected result and I will analyze it through the Senior Dev workflow."
      case "small_task":
        return this.executeSmallTask(message, root, userId)
      case "big_task":
        return this.startBigTask(message, root, userId)
    }
  }

  private handleSmallTalk(message: string) {
    const lower = message.toLowerCase()
    if (lower.includes("time")) return `Local time: ${new Date().toLocaleTimeString()}`
    if (lower.includes("date")) return `Date: ${new Date().toLocaleDateString()}`
    if (lower.includes("weather")) return "Weather lookup needs a configured weather provider."
    if (lower.includes("joke")) return "Bug report: the code worked once, so we called it production-ready."
    return "Ready to help. Type 'help' or send a task."
  }

  private async executeSmallTask(message: string, root: string, userId: string) {
    await this.emit({ taskId: "solo", userId, message, status: "Senior Dev analyzing", progress: 20, startedAt: Date.now(), updatedAt: Date.now() })
    const result = /\b(review|analy[sz]e|scan|inspect)\b/i.test(message)
      ? await this.seniorDev.analyze(root)
      : await this.seniorDev.fix(root, { runTests: true })
    return `Complete. ${result.summary}`
  }

  private async startBigTask(message: string, root: string, userId: string) {
    const id = taskId()
    const now = Date.now()
    const initial: TaskStatus = { taskId: id, userId, message, status: "Manager planning", progress: 5, startedAt: now, updatedAt: now }
    this.activeTasks.set(id, initial)
    await this.persist(initial)
    await this.manager.acceptTask(id, message, root)
    const ack = `${this.manager.acknowledgement()}\nTask ID: ${id}\nType 'status' to check progress.`
    const run = async () => {
      try {
        const result = await this.manager.runProject(message, root, {
          taskId: id,
          checkpoint: async () => {
            const control = await this.manager.consumeTaskControl(id)
            if (!control) return
            if (control.action === "pause" || control.action === "cancel") {
              throw new TaskControlInterruption(control.action)
            }
            if (control.action === "update") {
              const current = this.activeTasks.get(id) ?? initial
              await this.emit({ ...current, status: "Updated instruction accepted", updatedAt: Date.now() })
              return { instruction: control.instruction }
            }
          },
          onProgress: async (update) => {
            const status = this.fromTeamStatus(update, id, userId, message, now)
            await this.emit(status)
          },
        })
        const terminalStatus = result.status === "completed"
          ? "Complete"
          : result.status === "paused"
            ? "Paused"
            : result.status === "cancelled"
              ? "Cancelled"
              : "Needs review"
        const complete: TaskStatus = {
          ...this.activeTasks.get(id) ?? initial,
          status: terminalStatus,
          progress: result.status === "completed" ? 100 : (this.activeTasks.get(id)?.progress ?? initial.progress),
          updatedAt: Date.now(),
          result,
        }
        await this.emit(complete)
        if (this.options.notify !== false) await this.notifyUser(`Task ${id}: ${complete.status}`)
      } catch (error) {
        const failed: TaskStatus = { ...this.activeTasks.get(id) ?? initial, status: "Failed", progress: 100, updatedAt: Date.now(), error: error instanceof Error ? error.message : String(error) }
        await this.emit(failed)
        if (this.options.notify !== false) await this.notifyUser(`Task ${id}: failed`)
      }
    }
    if (this.options.background !== false) {
      void run()
    } else {
      await run()
    }
    return ack
  }

  private fromTeamStatus(update: TeamStatus, id: string, userId: string, message: string, startedAt: number): TaskStatus {
    return { taskId: id, userId, message, status: update.status, progress: update.progress, startedAt, updatedAt: update.updatedAt }
  }

  private async emit(status: TaskStatus) {
    this.activeTasks.set(status.taskId, status)
    await this.persist(status)
    await this.options.onUpdate?.(status)
  }

  private async persist(status: TaskStatus) {
    await mkdir(statusRoot, { recursive: true })
    await writeFile(join(statusRoot, `${status.taskId}.json`), JSON.stringify(status, null, 2) + "\n", "utf8")
  }

  async getActiveTasks(userId = "local") {
    const local = [...this.activeTasks.values()].filter((task) => task.userId === userId && !isTerminal(task.status))
    if (local.length > 0) return local
    const persisted = await this.manager.listTasks()
    return persisted
      .filter((task) => !["completed", "failed", "cancelled"].includes(task.state))
      .map((task) => ({
        taskId: task.id,
        userId,
        message: task.task,
        status: task.state === "paused" ? "Paused" : task.state === "accepted" ? "Starting" : "Running",
        progress: 0,
        startedAt: task.createdAt,
        updatedAt: task.updatedAt,
      }))
  }

  private async getActiveTaskStatus(userId: string) {
    const tasks = await this.getActiveTasks(userId)
    if (tasks.length === 0) return "All tasks are complete. Send another task any time."
    return ["Active tasks:", ...tasks.map((task) => `${this.progressBar(task.progress)} ${task.taskId} — ${task.status} (${task.progress}%)`)].join("\n")
  }

  private progressBar(progress: number) {
    const filled = Math.max(0, Math.min(10, Math.floor(progress / 10)))
    return `[${"#".repeat(filled)}${"-".repeat(10 - filled)}]`
  }

  private async handleCommand(message: string, userId: string) {
    const lower = message.trim().toLowerCase()
    const action: TaskControlAction | undefined = /^(stop|cancel|kill)\b/.test(lower)
      ? "cancel"
      : /^pause\b/.test(lower)
        ? "pause"
        : /^resume\b/.test(lower)
          ? "resume"
          : /^(update|change|instead|priority)\b/.test(lower)
            ? "update"
            : undefined
    if (!action) return "Command received."
    const tasks = await this.getActiveTasks(userId)
    const task = tasks.sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (!task) return "No active tasks found."
    const instruction = action === "update" ? message.replace(/^\s*(update|change|instead|priority)\b\s*/i, "").trim() : undefined
    if (action === "update" && !instruction) return "Tell me what to change, for example: update only inspect the API module."
    const controlled = await this.manager.controlTask(task.taskId, action, instruction)
    if (!controlled) return "The task is no longer available for control."
    const status = action === "cancel" ? "Cancellation requested" : action === "pause" ? "Pause requested" : action === "resume" ? "Resume requested" : "Update requested"
    const updated = { ...task, status, updatedAt: Date.now() }
    await this.emit(updated)
    return action === "update"
      ? `Updated task ${task.taskId}. The new instruction will apply at the next safe checkpoint.`
      : `${status} for ${task.taskId}. It will apply at the next safe checkpoint.`
  }

  private getHelpText() {
    return [
      "NEXUS User Liaison commands:",
      "  nexus dev read <github-url>   Clone/scan workflow entry",
      "  nexus dev analyze <path>      Static bug analysis",
      "  nexus dev fix <path>          Safe fix workflow",
      "  nexus dev review <path>       Review workflow",
      "  nexus dev optimize <path>     Performance review",
      "  nexus dev status              Active team status",
      "  stop / cancel                 Cancel active liaison tasks",
    ].join("\n")
  }

  private async notifyUser(message: string) {
    if (!process.env.TERMUX_VERSION || !process.env.PREFIX) return
    try {
      await execFileAsync("termux-notification", ["--title", "NEXUS", "--content", message], { timeout: 5000 })
    } catch {
      // Termux:API is optional; console/status files remain the source of truth.
    }
  }
}

function isTerminal(status: string) {
  return ["Complete", "Failed", "Cancelled"].includes(status)
}

export default UserLiaison
