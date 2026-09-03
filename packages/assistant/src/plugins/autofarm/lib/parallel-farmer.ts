// parallel-farmer: run multiple Gmail+API farm pipelines concurrently.
// Bounded by maxParallel (default 3) to avoid rate limits and browser
// resource exhaustion. Returns when all complete or fail.

import { createAccountViaBrowser, listAccounts, pendingVerify } from "../agents/gmail-agent.ts"
import { farmForGmail } from "../agents/provider-agent.ts"
import { log } from "./logger.ts"

export interface ParallelOptions {
  /** How many Gmail+API farm pipelines to run in parallel. */
  count: number
  /** Max concurrency (default 3). */
  maxParallel?: number
  /** Provider names to target (default: all FREE_PROVIDERS). */
  providers?: string[]
}

export interface ParallelResult {
  accounts: number
  totalKeys: number
  failures: number
  needsVerify: string[]
  perPipeline: Array<{ email: string; keys: number; status: string; error?: string }>
}

export async function runParallel(opts: ParallelOptions): Promise<ParallelResult> {
  const max = Math.max(1, Math.min(opts.maxParallel ?? 3, 8))
  const pipelines = Array.from({ length: opts.count }, (_, i) => i)
  const out: ParallelResult = {
    accounts: 0,
    totalKeys: 0,
    failures: 0,
    needsVerify: [],
    perPipeline: [],
  }

  // Simple semaphore
  let inFlight = 0
  let launched = 0
  let finished = 0
  const queue: number[] = [...pipelines]
  const results: Promise<void>[] = []

  return await new Promise<ParallelResult>((resolve) => {
    const finish = () => {
      finished++
      if (finished === pipelines.length) resolve(out)
    }
    const launchNext = () => {
      while (inFlight < max && queue.length > 0) {
        const idx = queue.shift()!
        inFlight++
        launched++
        const p = runOne(idx)
          .then((r) => {
            out.perPipeline.push(r)
            if (r.status === "active") out.accounts++
            if (r.keys > 0) out.totalKeys += r.keys
            if (r.status === "failed") out.failures++
            if (r.status === "needs-verify") out.needsVerify.push(r.email)
          })
          .catch((e) => {
            out.failures++
            out.perPipeline.push({ email: `pipeline-${idx}`, keys: 0, status: "failed", error: (e as Error).message })
          })
          .finally(() => {
            inFlight--
            finish()
            if (queue.length > 0) launchNext()
          })
        results.push(p)
      }
      if (pipelines.length === 0) resolve(out)
    }
    launchNext()
  })
}

async function runOne(idx: number): Promise<{ email: string; keys: number; status: string; error?: string }> {
  log.info("parallel", `pipeline ${idx}: starting`)
  try {
    const acc = await createAccountViaBrowser()
    if (acc.status === "needs-verify") {
      return { email: acc.email, keys: 0, status: "needs-verify" }
    }
    if (acc.status !== "active") {
      return { email: acc.email, keys: 0, status: "failed", error: acc.status }
    }
    const keys = await farmForGmail(acc)
    return { email: acc.email, keys: keys.length, status: "active" }
  } catch (e) {
    return { email: `pipeline-${idx}`, keys: 0, status: "failed", error: (e as Error).message }
  }
}
