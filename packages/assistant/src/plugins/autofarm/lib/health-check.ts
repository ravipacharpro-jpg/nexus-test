// health-check: cross-platform, no-deps, single-pass NEXUS / autofarm
// health summary. Read-only — never modifies state.
//
// Exposed as a TUI slash command (/health) AND a CLI command
// (nexus-autofarm health). One function powers both, so the user
// sees the same numbers regardless of where they invoke it.

import { existsSync, readFileSync, statSync } from "node:fs"
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import os from "node:os"
import { readVaultSummary } from "./vault-summary.ts"
import { isBrowserUseAvailable } from "./browser-use.ts"

export interface HealthRow {
  name: string
  status: "ok" | "warn" | "fail" | "info"
  detail: string
}

export interface HealthReport {
  rows: HealthRow[]
  generatedAt: string
}

const NEXUS_DIR = join(os.homedir(), ".nexus")
const VAULT = join(NEXUS_DIR, "api-vault.json")
const API_USAGE = join(NEXUS_DIR, "api-usage.json")
const MASTER_SESSION_DIR = NEXUS_DIR
const GMAIL_STORE = join(NEXUS_DIR, "autofarm", "gmails.json")

async function countGmailAccounts(): Promise<{ active: number; pending: number; total: number }> {
  if (!existsSync(GMAIL_STORE)) return { active: 0, pending: 0, total: 0 }
  try {
    const j = JSON.parse(readFileSync(GMAIL_STORE, "utf8")) as Array<{ status?: string }>
    const list = Array.isArray(j) ? j : []
    return {
      total: list.length,
      active: list.filter((a) => a.status === "active").length,
      pending: list.filter((a) => a.status === "needs-verify" || a.status === "pending").length,
    }
  } catch {
    return { active: 0, pending: 0, total: 0 }
  }
}

async function countMasterSessions(): Promise<number> {
  try {
    const list = await readdir(MASTER_SESSION_DIR)
    return list.filter((f) => f.startsWith("master-session-")).length
  } catch {
    return 0
  }
}

function isEnvOn(name: string): boolean {
  return process.env[name] === "1" || process.env[name] === "true"
}

/** Build the full health report. */
export async function buildHealthReport(): Promise<HealthReport> {
  const rows: HealthRow[] = []

  // 1. Vault
  const v = readVaultSummary()
  rows.push({
    name: "Vault",
    status: v.totalKeys === 0 ? "warn" : "ok",
    detail: `${v.totalActive} active / ${v.totalKeys} total across ${v.providers.length} provider(s) at ${v.path}`,
  })

  // 2. API usage
  if (existsSync(API_USAGE)) {
    try {
      const j = JSON.parse(readFileSync(API_USAGE, "utf8")) as Record<string, { todayRequests?: number }>
      const totalReq = Object.values(j).reduce((acc, v) => acc + (v.todayRequests ?? 0), 0)
      rows.push({ name: "API usage", status: "info", detail: `${totalReq} requests today across ${Object.keys(j).length} provider(s)` })
    } catch {
      rows.push({ name: "API usage", status: "warn", detail: "exists but unreadable" })
    }
  } else {
    rows.push({ name: "API usage", status: "info", detail: "no requests today" })
  }

  // 3. Browser adapter
  const bu = await isBrowserUseAvailable()
  rows.push({
    name: "Browser",
    status: bu.ok ? "ok" : "warn",
    detail: bu.ok ? `browser-use ${bu.version} (${bu.via})` : "no browser adapter — run scripts/install-browser-use.sh",
  })

  // 4. Quackr reachability
  try {
    const r = await fetch("https://quackr.io/", { signal: AbortSignal.timeout(5_000) })
    rows.push({ name: "Quackr.io (free phone)", status: r.ok ? "ok" : "warn", detail: `HTTP ${r.status}` })
  } catch (e) {
    rows.push({ name: "Quackr.io (free phone)", status: "fail", detail: (e as Error).message.slice(0, 80) })
  }

  // 5. Master Agent mode
  const masterOff = isEnvOn("NEXUS_NO_MASTER") || process.env.NEXUS_NO_MASTER !== "0"
  rows.push({ name: "Master Agent", status: "ok", detail: masterOff ? "disabled (NEXUS_NO_MASTER=1)" : "enabled (orchestration active)" })

  // 6. Queue mode
  const noQueue = isEnvOn("NEXUS_NO_QUEUE")
  rows.push({ name: "Queue", status: "ok", detail: noQueue ? "disabled (instant handoff)" : "enabled (messages may queue)" })

  // 7. Silent mode
  const silent = isEnvOn("NEXUS_SILENT_MASTER")
  rows.push({ name: "Silent master", status: "ok", detail: silent ? "enabled (one-line reply)" : "disabled (verbose log)" })

  // 8. Input mode
  const inputActive = isEnvOn("NEXUS_INPUT_ALWAYS_ACTIVE")
  rows.push({ name: "Input always-active", status: "ok", detail: inputActive ? "enabled (no 'pending' state)" : "disabled" })

  // 9. Gmail store
  const g = await countGmailAccounts()
  rows.push({
    name: "Gmail store",
    status: g.total === 0 ? "info" : "ok",
    detail: `${g.total} accounts (${g.active} active, ${g.pending} pending verify)`,
  })

  // 10. Master sessions
  const sessions = await countMasterSessions()
  rows.push({ name: "Master sessions", status: "info", detail: `${sessions} checkpoint file(s) in ${NEXUS_DIR}` })

  return { rows, generatedAt: new Date().toISOString() }
}

const STATUS_GLYPH: Record<HealthRow["status"], string> = {
  ok: "✓",
  warn: "!",
  fail: "x",
  info: "·",
}

const STATUS_COLOR: Record<HealthRow["status"], string> = {
  ok: "\x1b[32m", // green
  warn: "\x1b[33m", // yellow
  fail: "\x1b[31m", // red
  info: "\x1b[90m", // grey
}
const RESET = "\x1b[0m"

/** Plain text report (no colors). For TUI / logs. */
export function formatHealthText(r: HealthReport): string {
  const out: string[] = []
  out.push(`NEXUS health — ${r.generatedAt}`)
  for (const row of r.rows) {
    out.push(`  [${STATUS_GLYPH[row.status]}] ${row.name.padEnd(24)} ${row.detail}`)
  }
  return out.join("\n")
}

/** ANSI-colored version for terminals. */
export function formatHealthAnsi(r: HealthReport): string {
  const out: string[] = []
  out.push(`NEXUS health — ${r.generatedAt}`)
  for (const row of r.rows) {
    const tag = `${STATUS_COLOR[row.status]}[${STATUS_GLYPH[row.status]}]${RESET}`
    const name = row.name.padEnd(24)
    out.push(`  ${tag} ${name} ${row.detail}`)
  }
  return out.join("\n")
}
