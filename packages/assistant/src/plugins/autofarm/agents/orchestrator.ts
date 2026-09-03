// Orchestrator: the brain that decides when to farm, when to rest,
// and when to call the fixer agent. Now delegates to the new
// demand-supply engine (lib/demand-supply.ts) which auto-discovers
// new free providers when supply < demand.

import { log } from "../lib/logger.ts"
import { snapshot, loadLevel, predictExhaustion } from "./monitor-agent.ts"
import { record } from "./demand-agent.ts"
import { createMany, listAccounts, pendingVerify } from "./gmail-agent.ts"
import { farmForGmail } from "./provider-agent.ts"
import { runFixers } from "./fixer-agent.ts"
import { vaultSummary } from "../lib/vault.ts"
import type { FarmStatus } from "../lib/types.ts"
import { decide as dsDecide, runOnce as dsRunOnce } from "../lib/demand-supply.ts"

let loopHandle: ReturnType<typeof setInterval> | null = null
let running = false

/** Bridge: old decide() shape preserved for backward compat, but powered by the new engine. */
function decide(): { status: FarmStatus; action: string; gap: number; ratio: number } {
  const d = dsDecide()
  const s = snapshot()
  // Map new engine's recommendation back to FarmStatus
  let status: FarmStatus = "monitor"
  if (d.status === "surplus") status = "surplus"
  else if (d.status === "balanced") status = "monitor"
  else if (d.status === "low") status = "low"
  else if (d.status === "critical") status = "critical"
  else if (d.status === "discovering") status = "low"
  if (s.load.loadLevel === "high") status = "throttled"
  return { status, action: d.recommendation, gap: d.gap, ratio: d.ratio }
}

export interface CycleResult {
  status: FarmStatus
  action: string
  newGmails: number
  newKeys: number
  fixed: number
  discovered?: number
  validated?: number
}

export async function runCycle(): Promise<CycleResult> {
  if (running) {
    log.warn("orchestrator", "Cycle already running, skipping")
    return { status: "monitor", action: "skip", newGmails: 0, newKeys: 0, fixed: 0 }
  }
  running = true
  let newGmails = 0
  let newKeys = 0
  let fixed = 0
  try {
    // Use the new demand-supply engine: discover + validate + auto-farm.
    const ds = await dsRunOnce({ autoAdd: true, autoFarm: true, autoNotify: true })
    const decision = decide()

    // If we have a Gmail waiting on the user, do nothing — the user must
    // complete the verification before we can continue.
    const pending = pendingVerify()
    if (pending.length) {
      log.info("orchestrator", `${pending.length} Gmail(s) waiting on user verification — pausing`)
      return { status: "monitor", action: "await-user-verify", newGmails: 0, newKeys: 0, fixed: 0, discovered: ds.discovered.length, validated: ds.validated.length }
    }

    if (decision.status === "throttled" || decision.status === "surplus") {
      log.info("orchestrator", `${decision.status} — resting`)
      return { status: decision.status, action: decision.action, newGmails: 0, newKeys: 0, fixed: 0, discovered: ds.discovered.length, validated: ds.validated.length }
    }

    if (decision.status === "critical" || decision.status === "low") {
      // Create one new Gmail + farm providers for it.
      const accounts = await createMany(1)
      newGmails = accounts.length
      for (const acc of accounts) {
        if (acc.status !== "active") continue
        const keys = await farmForGmail(acc)
        newKeys += keys.length
        for (const k of keys) record(k.provider, 1000, "normal")
      }
    }

    if (decision.status === "critical") {
      const fixes = await runFixers()
      fixed = fixes.filter((f) => f.ok).length
    }

    return {
      status: decision.status,
      action: decision.action,
      newGmails,
      newKeys,
      fixed,
      discovered: ds.discovered.length,
      validated: ds.validated.length,
    }
  } finally {
    running = false
  }
}

export function startLoop(intervalMs = 5 * 60_000): void {
  if (loopHandle) {
    log.warn("orchestrator", "Loop already running")
    return
  }
  log.ok("orchestrator", `Starting loop every ${intervalMs}ms`)
  void runCycle().catch((e) => log.error("orchestrator", String(e)))
  loopHandle = setInterval(() => {
    void runCycle().catch((e) => log.error("orchestrator", String(e)))
  }, intervalMs)
}

export function stopLoop(): void {
  if (!loopHandle) return
  clearInterval(loopHandle)
  loopHandle = null
  log.ok("orchestrator", "Loop stopped")
}

export function loopStatus(): { running: boolean; accounts: number } {
  return { running: !!loopHandle, accounts: listAccounts().length }
}

export function decidePublic() {
  return decide()
}

export function predictPublic() {
  return predictExhaustion()
}

export function loadPublic() {
  return loadLevel()
}