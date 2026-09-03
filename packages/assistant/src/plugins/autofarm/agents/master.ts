// Master farm command — combines the in-process autofarm pipeline with
// the existing Python-based nexus-keyfarm subsystem.
//
//   1. Read demand-supply snapshot
//   2. Run in-process orchestrator decide() / cycle()
//   3. If Python bridge is installed, also kick a --auto cycle on the Python side
//   4. Pull demand-supply + farm-log JSON for the operator
//
// The goal is to let `nexus autofarm master` give a single comprehensive
// status without the operator having to remember which subsystem each
// command lives in.

import { log } from "../lib/logger.ts"
import { decidePublic, predictPublic, loadPublic, runCycle, startLoop, stopLoop, loopStatus } from "./orchestrator.ts"
import { pythonBridge, pythonInstalled } from "../lib/python-bridge.ts"
import { snapshot as monitorSnapshot } from "./monitor-agent.ts"
import { vaultSummary } from "../lib/vault.ts"
import { pendingVerify, listAccounts } from "./gmail-agent.ts"

export interface MasterReport {
  ts: string
  inProcess: {
    decision: ReturnType<typeof decidePublic>
    load: ReturnType<typeof loadPublic>
    loopRunning: boolean
    predictions: ReturnType<typeof predictPublic>
    monitor: ReturnType<typeof monitorSnapshot>
    vault: ReturnType<typeof vaultSummary>
    pendingVerify: number
    activeGmails: number
  }
  python: {
    available: boolean
    autoRan: boolean
    stdoutTail: string
    stderrTail: string
    ms: number
    ok: boolean
  } | null
}

export async function runMaster(opts: { autoRunPython?: boolean; intervalMs?: number } = {}): Promise<MasterReport> {
  const inProcess = {
    decision: decidePublic(),
    load: loadPublic(),
    loopRunning: loopStatus().running,
    predictions: predictPublic(),
    monitor: monitorSnapshot(),
    vault: vaultSummary(),
    pendingVerify: pendingVerify().length,
    activeGmails: listAccounts().filter((a) => a.status === "active").length,
  }
  log.info("master", `decision=${inProcess.decision.status} action=${inProcess.decision.action}`)

  // Always run one orchestrator cycle to keep the vault fresh.
  await runCycle().catch((e) => log.warn("master", `cycle failed: ${(e as Error).message}`))

  // If the operator asked for it, kick a Python --auto as well.
  let python: MasterReport["python"] = null
  if (pythonInstalled()) {
    if (opts.autoRunPython) {
      const r = await pythonBridge.autoFarm()
      python = {
        available: true,
        autoRan: true,
        stdoutTail: r.stdout.slice(-2000),
        stderrTail: r.stderr.slice(-1000),
        ms: r.ms,
        ok: r.ok,
      }
    } else {
      const snap = await pythonBridge.demandSnapshot()
      python = {
        available: true,
        autoRan: false,
        stdoutTail: snap.stdout.slice(-2000),
        stderrTail: snap.stderr.slice(-500),
        ms: snap.ms,
        ok: snap.ok,
      }
    }
  } else {
    log.warn("master", "Python keyfarm subsystem not found — running only in-process pipeline")
  }

  return { ts: new Date().toISOString(), inProcess, python }
}

export function startMasterLoop(intervalMs = 5 * 60_000): void {
  startLoop(intervalMs)
  log.info("master", "Both in-process orchestrator and master loop started")
}

export function stopMasterLoop(): void {
  stopLoop()
  log.info("master", "Stopped")
}

// ---------------------------------------------------------------------------
// Smart "add N keys" routing
//
// The user said: "main yahan chat me bolu 5 key add karwao to uske paas msg
// chala jaye aur vo kaam pe lag jaye". This function is the entry point the
// CLI / TUI calls when it parses a natural-language instruction like
// "5 OpenRouter API keys add karwao" or "3 Groq keys farm karwa do".
//
// Behavior:
//   - The function NEVER asks the user for a key. If a fresh farmable key is
//     available, it adds it. If not, it returns a structured plan describing
//     which agents will run and what the user will need to do (captcha handoff,
//     phone verification, etc.) so the user is informed but not interrupted.
//   - The work is dispatched to the existing orchestrator which already knows
//     how to drive the gmail-agent, provider-agent and monitor-agent.
//   - On devices without a working browser adapter (Termux) the result still
//     ends with a clear "manual handoff required" message rather than a
//     silent no-op, so the user understands what happened.
import { runCycle } from "./orchestrator.ts"
import { vaultSummary } from "../lib/vault.ts"

export interface SmartAddKeysPlan {
  requested: number
  provider: string
  feasibleNow: boolean
  reason: string
  startedCycle: boolean
  before: ReturnType<typeof vaultSummary>
  after?: ReturnType<typeof vaultSummary>
  nextSteps: string[]
}

export async function smartAddKeys(opts: { count: number; provider: string }): Promise<SmartAddKeysPlan> {
  const before = vaultSummary()
  const plan: SmartAddKeysPlan = {
    requested: Math.max(1, opts.count | 0),
    provider: opts.provider,
    feasibleNow: false,
    reason: "",
    startedCycle: false,
    before,
    nextSteps: [],
  }

  // Always kick the orchestrator so it tries to find, validate and add keys.
  // It already knows how to handle browser-adapter availability internally.
  try {
    await runCycle()
    plan.startedCycle = true
  } catch (e) {
    plan.reason = `cycle failed: ${(e as Error).message}`
  }

  plan.after = vaultSummary()
  const gained = plan.after.totalKeys - plan.before.totalKeys
  plan.feasibleNow = gained >= plan.requested

  if (!plan.feasibleNow) {
    plan.reason =
      plan.reason ||
      (gained === 0
        ? "no fresh key was added in this cycle (browser/captcha/email-verify may require manual handoff)"
        : `only ${gained} of ${plan.requested} requested keys were added this cycle`)
  }
  plan.nextSteps = plan.feasibleNow
    ? [`vault now holds ${plan.after.activeKeys} active ${plan.provider} key(s) ready for routing`]
    : [
        `inspect 'nexus-autofarm status' for the latest cycle result`,
        `if a captcha / phone prompt is pending, complete it on the device whose browser handoff link was logged`,
        `re-run 'smart-add-keys' after the handoff so the orchestrator can pick up where it left off`,
      ]
  log.info("master", `smartAddKeys: requested=${plan.requested} provider=${plan.provider} gained=${gained} feasibleNow=${plan.feasibleNow}`)
  return plan
}