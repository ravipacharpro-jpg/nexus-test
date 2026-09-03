import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { StaffManager } from "./StaffManager"
import { FreelancerDB } from "./FreelancerDB"
import { BotAgent } from "./agents/BotAgent"
import { DebugAgent } from "./agents/DebugAgent"
import { ToolAgent } from "./agents/ToolAgent"
import { SmartManager } from "./agents/SmartManager"
import { INTERRUPTED_BY_RESTART, MAX_TASK_ATTEMPTS } from "./agents/SmartManager"
import type { PersistedTask } from "./agents/SmartManager"
import { readPowerStatus, workloadPolicy } from "@nexus-ai/core/power"
import { ServiceManager } from "./ServiceManager"
import { runtimeGuard } from "./RuntimeGuard"
import type { RuntimeGuardVerdict } from "./RuntimeGuard"
import type { PowerStatus } from "@nexus-ai/core/power"

export type BusinessmanResult = {
  jobId: string
  plan: ReturnType<StaffManager["brain"]["analyze"]>
  hired: Array<{ name: string; success: boolean; sizeMB: number; alreadyThere?: boolean }>
  result: unknown
  keepTeam: boolean
  savedMB: number
}

export type HandleTaskOptions = {
  /** Attempts already spent by earlier records for the same logical task; the fresh dispatch becomes inheritedAttempts + 1. */
  inheritedAttempts?: number
}

export type InterruptedTaskRecovery = {
  id: string
  task: string
  action: "failed" | "resumed" | "skipped"
  attempts: number
  jobId?: string
  reason?: string
}

export type RecoverySummary = {
  interrupted: number
  recoveries: InterruptedTaskRecovery[]
}

export type BusinessmanDependencies = {
  staff?: StaffManager
  botAgent?: Pick<BotAgent, "execute">
  toolAgent?: Pick<ToolAgent, "execute">
  debugAgent?: Pick<DebugAgent, "execute">
  services?: Pick<ServiceManager, "acquireWakeLock" | "releaseWakeLock" | "notify" | "toast">
  readPowerStatus?: () => Promise<PowerStatus>
  queue?: Pick<SmartManager, "accept" | "update"> & Partial<Pick<SmartManager, "stalePending" | "list">>
  runtimeGuard?: () => Promise<RuntimeGuardVerdict>
}

export class Businessman {
  readonly staff: StaffManager
  readonly freelancers = new FreelancerDB()
  readonly activeJobs = new Map<string, { command: string; startedAt: number }>()
  private readonly botAgent: Pick<BotAgent, "execute">
  private readonly toolAgent: Pick<ToolAgent, "execute">
  private readonly debugAgent: Pick<DebugAgent, "execute">
  private readonly services: Pick<ServiceManager, "acquireWakeLock" | "releaseWakeLock" | "notify" | "toast">
  private readonly powerStatusReader: () => Promise<PowerStatus>
  private readonly queue: Pick<SmartManager, "accept" | "update"> & Partial<Pick<SmartManager, "stalePending" | "list">>
  private readonly deviceGuard: () => Promise<RuntimeGuardVerdict>
  private readonly startedAt = Date.now()
  private recoveryRun?: Promise<RecoverySummary>

  constructor(dependencies: BusinessmanDependencies = {}) {
    this.staff = dependencies.staff ?? new StaffManager()
    this.botAgent = dependencies.botAgent ?? new BotAgent()
    this.toolAgent = dependencies.toolAgent ?? new ToolAgent()
    this.debugAgent = dependencies.debugAgent ?? new DebugAgent()
    this.services = dependencies.services ?? new ServiceManager()
    this.powerStatusReader = dependencies.readPowerStatus ?? readPowerStatus
    this.queue = dependencies.queue ?? new SmartManager()
    this.deviceGuard = dependencies.runtimeGuard ?? runtimeGuard
  }

  async handleTask(userCommand: string, options: HandleTaskOptions = {}): Promise<BusinessmanResult> {
    await this.ensureRecovered()
    const attempts = (options.inheritedAttempts ?? 0) + 1
    const jobId = `job-${Date.now().toString(36)}`
    const plan = this.staff.brain.analyze(userCommand)
    this.activeJobs.set(jobId, { command: userCommand, startedAt: Date.now() })
    // Persist the task record before the CLI acknowledges acceptance.
    // Capacity is left undefined so SmartManager applies its default plan.
    await this.queue.accept(jobId, userCommand, process.cwd(), undefined, attempts)
    const power = await this.powerStatusReader()
    const policy = workloadPolicy(power)
    let wakeLockHeld = false

    console.log("🧠 Task analyzed successfully")
    console.log(`   Required: ${plan.workersNeeded.join(" + ") || "core team only"}`)
    console.log(`   Estimate: ${plan.estimatedSize} download, ~${plan.estimatedTime}`)
    if (policy.throttled) {
      console.warn(`⚠️ Mobile resource protection enabled: ${policy.reason}. Limiting this task to ${policy.maxConcurrency ?? 1} worker.`)
      if (policy.preferredModel) console.warn(`   Recommended lightweight local model: ${policy.preferredModel}`)
    }
    try {
      await this.services.acquireWakeLock()
      wakeLockHeld = true
    } catch {
      // Native Termux is optional; desktop and unsupported Android environments retain existing behavior.
    }

    const hired: Array<{ name: string; success: boolean; sizeMB: number; alreadyThere?: boolean }> = []
    try {
      const matchedWorkers = this.staff.brain.matchFreelancers(plan)
      const selectedWorkers = policy.maxConcurrency ? matchedWorkers.slice(0, policy.maxConcurrency) : matchedWorkers
      for (const worker of selectedWorkers) {
        await this.assertDeviceReady()
        const result = await this.staff.hire.hire(worker)
        hired.push({ name: worker, success: result.success, sizeMB: result.sizeMB, alreadyThere: result.alreadyThere })
      }

      const failedHires = hired.filter((worker) => !worker.success && !worker.alreadyThere)
      if (failedHires.length > 0) {
        const names = failedHires.map((worker) => worker.name).join(", ")
        console.error(`❌ Required workers failed to install: ${names}. Task aborted.`)
        console.error("   Close other package-manager processes or install them manually, then re-run.")
        throw new Error(`dependency installation failed for: ${names}`)
      }

      await this.assertDeviceReady()
      console.log("⚒️ Starting task execution...")
      const hiredWorkers = hired.filter((worker) => worker.success).map((worker) => worker.name)
      const context = { hiredWorkers }
      // Partial-agent gate: before dispatching to BotAgent or
      // ToolAgent (both marked 'partial' in the autofarm
      // capability registry), warn the user that the result is
      // a fixed template, not a real model response. The
      // warning only fires on interactive TTY so the gate does
      // not block the autofarm master / non-interactive CI.
      await warnIfPartialAgent(this.botAgent, "BotAgent", plan.taskType === "bot", this.askUser.bind(this))
      const generated = plan.taskType === "bot"
        ? await this.botAgent.execute(userCommand, context)
        : await this.toolAgent.execute(userCommand, context)
      await warnIfPartialAgent(this.toolAgent, "ToolAgent", plan.taskType !== "bot", this.askUser.bind(this))
      const checked = await this.debugAgent.execute(userCommand, {
        ...context,
        outputDir: (generated as { outputDir?: string }).outputDir,
      })
      const result = { generated, checked }
      await this.queue.update(jobId, "completed")
      console.log(`✅ Task completed.${(generated as { outputDir?: string }).outputDir ? ` Files: ${(generated as { outputDir: string }).outputDir}` : ""}`)
      void this.services.notify("NEXUS task completed", userCommand.slice(0, 120)).catch(() => undefined)
      void this.services.toast("NEXUS task completed").catch(() => undefined)

      const keepTeam = hired.length > 0 ? await this.askUser("💾 Keep hired workers available? (y/n): ") : true
      let savedMB = 0
      if (!keepTeam && hired.length > 0) {
        savedMB = await this.staff.fire.fireMany(hired)
        console.log(`📊 Storage reclaimed: ${savedMB}MB`)
      } else if (keepTeam && hired.length > 0) {
        console.log(`💼 Kept on payroll: ${hired.map((worker) => worker.name).join(", ")}`)
      }

      return { jobId, plan, hired, result, keepTeam, savedMB }
    } catch (error) {
      await this.queue
        .update(jobId, "failed", error instanceof Error ? error.message : String(error))
        .catch(() => undefined)
      console.error("❌ Task failed. NEXUS will release temporary mobile resources.")
      void this.services.notify("NEXUS task failed", userCommand.slice(0, 120)).catch(() => undefined)
      void this.services.toast("NEXUS task failed").catch(() => undefined)
      throw error
    } finally {
      if (wakeLockHeld) void this.services.releaseWakeLock().catch(() => undefined)
      this.activeJobs.delete(jobId)
    }
  }

  async recoverInterrupted(): Promise<RecoverySummary> {
    const stale = (await this.queue.stalePending?.(this.startedAt)) ?? []
    const recoveries: InterruptedTaskRecovery[] = []
    for (const record of stale) {
      console.warn(`⚠️ Task ${record.id} was accepted before this process started and never finished; treating it as interrupted by a restart.`)
      await this.queue.update(record.id, "failed", INTERRUPTED_BY_RESTART).catch(() => undefined)
      recoveries.push({ id: record.id, task: record.task, action: "failed", attempts: record.attempts ?? 1 })
    }
    if (recoveries.length > 0)
      console.warn(`⚠️ Crash recovery marked ${recoveries.length} interrupted task(s) as failed. Call resumePending() to re-run them.`)
    return { interrupted: recoveries.length, recoveries }
  }

  async resumePending(): Promise<InterruptedTaskRecovery[]> {
    await this.ensureRecovered()
    const interrupted = ((await this.queue.list?.()) ?? [])
      .filter((record) => record.state === "failed" && record.error === INTERRUPTED_BY_RESTART)
    const outcomes: InterruptedTaskRecovery[] = []
    for (const record of interrupted) {
      const previousAttempts = record.attempts ?? 1
      if (previousAttempts >= MAX_TASK_ATTEMPTS) {
        console.warn(`⚠️ Skipping ${record.id}: attempt limit of ${MAX_TASK_ATTEMPTS} reached; refusing to re-run it.`)
        await this.queue
          .update(record.id, "failed", `${INTERRUPTED_BY_RESTART}; attempt limit of ${MAX_TASK_ATTEMPTS} reached`)
          .catch(() => undefined)
        outcomes.push({ id: record.id, task: record.task, action: "skipped", attempts: previousAttempts, reason: `attempt limit of ${MAX_TASK_ATTEMPTS} reached` })
        continue
      }
      console.log(`🔁 Re-running interrupted task ${record.id} from its original instruction (attempt ${previousAttempts + 1} of ${MAX_TASK_ATTEMPTS}).`)
      outcomes.push(await this.dispatchRetry(record))
    }
    const resumed = outcomes.filter((outcome) => outcome.action === "resumed").length
    if (outcomes.length > 0)
      console.log(`📋 Resume summary: ${resumed} re-dispatched, ${outcomes.length - resumed} skipped, of ${outcomes.length} interrupted task(s).`)
    return outcomes
  }

  async askUser(prompt: string): Promise<boolean> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.log(`${prompt} n (non-interactive default)`)
      return false
    }
    const rl = createInterface({ input, output })
    try {
      const answer = await rl.question(prompt)
      return answer.trim().toLowerCase().startsWith("y")
    } finally {
      rl.close()
    }
  }

  private ensureRecovered(): Promise<RecoverySummary> {
    this.recoveryRun ??= this.recoverInterrupted()
    return this.recoveryRun
  }

  // Retries go through the normal flow so they get the same persistence, guards, and notifications.
  private async dispatchRetry(record: PersistedTask): Promise<InterruptedTaskRecovery> {
    const attempts = (record.attempts ?? 1) + 1
    const outcome = await this.handleTask(record.task, { inheritedAttempts: attempts - 1 })
      .then((result): InterruptedTaskRecovery => ({ id: record.id, task: record.task, action: "resumed", attempts, jobId: result.jobId }))
      .catch((error: unknown): InterruptedTaskRecovery => ({
        id: record.id,
        task: record.task,
        action: "resumed",
        attempts,
        reason: error instanceof Error ? error.message : String(error),
      }))
    // Retag the old record only after a completed retry so a failed retry stays eligible until the cap stops it.
    if (outcome.jobId)
      void this.queue.update(record.id, "failed", `${INTERRUPTED_BY_RESTART}; resumed as ${outcome.jobId}`).catch(() => undefined)
    return outcome
  }

  private async assertDeviceReady() {
    const verdict = await this.deviceGuard()
    if (verdict.ok) return
    throw new Error(`aborted by device guard: ${verdict.reason}`)
  }
}

/**
 * Partial-agent gate. Each stub agent in packages/termux-core
 * ships a literal `name` field (e.g. "bot-agent", "tool-agent")
 * that matches the id in
 * packages/assistant/src/plugins/autofarm/lib/partial-features.ts.
 * When the Businessman is about to dispatch to one, we print a
 * one-line warning to stderr and (on a TTY) give the user a
 * chance to abort. Non-interactive runs (autofarm, CI, scripts)
 * log the warning and proceed so the gate never breaks existing
 * automation.
 */
async function warnIfPartialAgent(
  agent: { readonly name?: string },
  displayName: string,
  willDispatch: boolean,
  askUser: (prompt: string) => Promise<boolean>,
): Promise<void> {
  if (!willDispatch) return
  const isPartial = agent.name === "bot-agent" || agent.name === "tool-agent"
  if (!isPartial) return
  const reason = `${displayName} is marked 'partial' in the NEXUS capability registry — it returns a hardcoded template, not a real model response. Output will be syntactically validated (py_compile / bash -n) but not semantically checked.`
  console.warn(`⚠️  partial-agent gate: ${reason}`)
  if (!process.stdin.isTTY || !process.stdout.isTTY) return
  const keep = await askUser("   proceed anyway? (y/n): ")
  if (!keep) throw new Error(`aborted by user at partial-agent gate (${displayName})`)
}
