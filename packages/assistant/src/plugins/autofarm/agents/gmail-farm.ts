// gmail-farm: orchestrate the full pipeline.
//
//   1. Create N Gmail accounts (parallel, but capped so we don't
//      launch 20 browser tabs at once).
//   2. For every Gmail, sign up to the configured set of free
//      LLM providers and pull a real API key from each.
//   3. Add every successful key to ~/.nexus/api-vault.json.
//
// The work is mostly delegated to existing pieces:
//   - createMany() from gmail-agent.ts for step 1
//   - farmForGmail() from provider-agent.ts for step 2
//   - addKey() from lib/vault.ts for step 3
//
// The only new logic here is: cross-Gmail parallelism cap, the
// per-gmail provider list, and the final roll-up report.
//
// Phone-verify handoff is intentionally NOT handled here. Each
// Gmail that hits the Google phone-verification wall is returned
// with status='needs-verify' and skipped. The user can run
//   nexus-autofarm verify-email <gmail> ok
// after solving the captcha / phone in the handoff browser.
//
// Cross-platform: pure TS, no native deps, no shell. Works on
// Termux, Linux, macOS, Windows.

import { log } from "../lib/logger.ts"
import { addKey } from "../lib/vault.ts"
import { createMany, listAccounts } from "./gmail-agent.ts"
import { farmForGmail } from "./provider-agent.ts"
import { FREE_PROVIDERS, getProvider, type FreeProvider } from "../lib/config.ts"
import type { GmailAccount } from "../lib/types.ts"

export interface GmailFarmOptions {
  /** How many Gmail accounts to create. Default 3. */
  gmailCount?: number
  /** Which providers to attempt, by name. Default = all FREE_PROVIDERS. */
  providers?: string[]
  /** Max concurrent browser sessions. Default 2 (safe for Termux). */
  maxParallel?: number
  /** When true, do not skip providers that already have vault keys. */
  allowDuplicateProviders?: boolean
}

export interface GmailFarmReport {
  startedAt: string
  finishedAt: string
  totalMs: number
  gmailsAttempted: number
  gmailsCreated: number
  gmailsPendingVerify: number
  providersAttempted: number
  keysAdded: number
  keysFailed: number
  errors: string[]
}

const DEFAULT_MAX_PARALLEL = 2

/** Map a FreeProvider[] to a unique, deduplicated list of provider names. */
function pickProviderNames(providers: string[] | undefined): string[] {
  const all = providers && providers.length > 0 ? providers : FREE_PROVIDERS.map((p) => p.name)
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of all) {
    if (seen.has(n)) continue
    if (!getProvider(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

/**
 * Run the full Gmail → multi-provider key farm pipeline.
 * Long-running; the caller is expected to print the return value
 * as a multi-line status table.
 */
export async function gmailFarm(opts: GmailFarmOptions = {}): Promise<GmailFarmReport> {
  const t0 = Date.now()
  const gmailCount = Math.max(1, Math.min(20, opts.gmailCount ?? 3))
  const providerNames = pickProviderNames(opts.providers)
  const maxParallel = Math.max(1, Math.min(8, opts.maxParallel ?? DEFAULT_MAX_PARALLEL))

  const report: GmailFarmReport = {
    startedAt: new Date(t0).toISOString(),
    finishedAt: "",
    totalMs: 0,
    gmailsAttempted: gmailCount,
    gmailsCreated: 0,
    gmailsPendingVerify: 0,
    providersAttempted: providerNames.length,
    keysAdded: 0,
    keysFailed: 0,
    errors: [],
  }

  log.info(
    "gmail-farm",
    `start: ${gmailCount} gmail(s) x ${providerNames.length} provider(s) (max ${maxParallel} parallel)`,
  )

  // Step 1: create the Gmail accounts. We use the existing createMany
  // for safety, but cap how many we ask for at a time to match
  // maxParallel.
  const gmails: GmailAccount[] = []
  for (let i = 0; i < gmailCount; i += maxParallel) {
    const batchSize = Math.min(maxParallel, gmailCount - i)
    const batch = await createMany(batchSize)
    for (const g of batch) {
      gmails.push(g)
      if (g.status === "active" || g.status === "pending") report.gmailsCreated++
      if (g.status === "needs-verify") report.gmailsPendingVerify++
    }
  }

  if (gmails.length === 0) {
    report.errors.push("no Gmail accounts were created (browser adapter missing? Phone verify blocking?)")
    report.finishedAt = new Date().toISOString()
    report.totalMs = Date.now() - t0
    return report
  }

  // Step 2 + 3: for each Gmail, farm every requested provider.
  // We deliberately do Gmail-major parallelism (one Gmail at a time
  // per provider loop) because a single Gmail's signup forms share
  // cookies / browser session. maxParallel caps the Gmail count.
  for (const g of gmails) {
    if (g.status === "needs-verify" || g.status === "blocked" || g.status === "failed") {
      log.info("gmail-farm", `skip ${g.email} (status=${g.status})`)
      continue
    }
    const farmResult = await farmForGmail(g).catch((e) => {
      report.errors.push(`farmForGmail(${g.email}) failed: ${(e as Error).message}`)
      return [] as Awaited<ReturnType<typeof farmForGmail>>
    })
    for (const k of farmResult) {
      const r = addKey({
        provider: k.provider,
        key: k.key,
        email: g.email,
        createdAt: k.createdAt,
        status: k.status,
        latencyMs: k.latencyMs,
        validatedAt: k.validatedAt,
        label: k.label,
        source: "farm",
      })
      if (r.added) report.keysAdded++
      else report.keysFailed++
    }
  }

  report.finishedAt = new Date().toISOString()
  report.totalMs = Date.now() - t0
  log.ok(
    "gmail-farm",
    `done: ${report.gmailsCreated}/${report.gmailsAttempted} gmail(s), ${report.keysAdded} key(s) added in ${(report.totalMs / 1000).toFixed(1)}s`,
  )
  return report
}

/** Format the report as a multi-line status block for the CLI / TUI. */
export function formatGmailFarmReport(r: GmailFarmReport): string {
  const lines: string[] = []
  lines.push("Gmail farm report")
  lines.push(`  start:    ${r.startedAt}`)
  lines.push(`  end:      ${r.finishedAt}  (${(r.totalMs / 1000).toFixed(1)}s)`)
  lines.push(`  gmails:   ${r.gmailsCreated} active / ${r.gmailsPendingVerify} pending verify / ${r.gmailsAttempted} attempted`)
  lines.push(`  providers: ${r.providersAttempted} configured`)
  lines.push(`  keys:     ${r.keysAdded} added / ${r.keysFailed} skipped/duplicate`)
  if (r.errors.length > 0) {
    lines.push(`  errors:`)
    for (const e of r.errors) lines.push(`    - ${e}`)
  }
  // Quick list of currently known Gmail accounts (newest first).
  const all = listAccounts()
  if (all.length > 0) {
    lines.push(`  accounts (${all.length} total):`)
    for (const a of all.slice(0, 10)) {
      lines.push(`    · ${a.email}  status=${a.status}  keys=${a.keysGenerated}`)
    }
    if (all.length > 10) lines.push(`    … and ${all.length - 10} more`)
  }
  return lines.join("\n")
}
