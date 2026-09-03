// bug-reporter: format + persist bug reports for the NEXUS update
// mechanism. When a bug is found, this builds a structured report
// that can be displayed in `nexus update` so the user knows:
//
//   1. WHAT was broken (e.g. "vault corrupted")
//   2. WHERE (file path, line number when available)
//   3. WHEN (timestamp + device)
//   4. WHAT we did to fix it
//   5. WHAT to do if it persists
//
// Reports are written to:
//   ~/.nexus/autofarm/health-reports.jsonl   (append-only log)
//   ~/.nexus/autofarm/last-report.json        (latest snapshot)

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { log } from "./logger.ts"
import type { HealthSummary } from "./auto-fixer.ts"
import type { BugReport } from "./bug-detector.ts"

const REPORTS_DIR = path.join(os.homedir(), ".nexus", "autofarm")
const REPORT_LOG = path.join(REPORTS_DIR, "health-reports.jsonl")
const LATEST = path.join(REPORTS_DIR, "last-report.json")

export interface HealthReport {
  /** Schema version for forward compat. */
  schema: 1
  ts: number
  iso: string
  /** NEXUS version the report was generated on. */
  nexusVersion: string
  /** Device that produced the report. */
  device: {
    hostname: string
    os: string
    arch: string
    node: string
  }
  /** Summary metrics. */
  summary: {
    findings: number
    fixed: number
    needsUser: number
    failed: number
  }
  /** Each finding + fix result. */
  items: Array<{
    severity: BugReport["severity"]
    category: BugReport["category"]
    title: string
    detail: string
    status: "applied" | "skipped" | "failed" | "needs-user"
    fixMessage: string
    userAction?: string
  }>
  /** Auto-generated user instructions. */
  recommendations: string[]
  /** Whether the user should run an update. */
  updateRecommended: boolean
}

function deviceBlock() {
  return {
    hostname: os.hostname(),
    os: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    node: process.version,
  }
}

function readNexusVersion(): string {
  try {
    const f = path.join(os.homedir(), "nexus", "VERSION")
    if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim()
  } catch {}
  return "0.1.66"
}

function buildRecommendations(summary: HealthSummary): string[] {
  const out: string[] = []
  if (summary.failed > 0) {
    out.push(`run: nexus autofarm bugs recent   (check ${summary.failed} failed fix(es))`)
  }
  if (summary.needsUser > 0) {
    out.push(`review ${summary.needsUser} item(s) that need manual action`)
  }
  if (summary.findings > 0) {
    out.push(`run: nexus autofarm health    (verify all is green)`)
  }
  if (summary.findings === 0) {
    out.push("all green — no action required")
  }
  return out
}

/** Build a structured report from a HealthSummary. */
export function buildReport(summary: HealthSummary): HealthReport {
  return {
    schema: 1,
    ts: summary.ts,
    iso: new Date(summary.ts).toISOString(),
    nexusVersion: readNexusVersion(),
    device: deviceBlock(),
    summary: {
      findings: summary.findings,
      fixed: summary.fixed,
      needsUser: summary.needsUser,
      failed: summary.failed,
    },
    items: summary.details.map((d) => ({
      severity: d.severity,
      category: d.category,
      title: d.title,
      detail: "", // we don't carry detail in HealthSummary; can be filled later
      status: d.status,
      fixMessage: d.message,
    })),
    recommendations: buildRecommendations(summary),
    updateRecommended: summary.failed > 0 || summary.findings >= 3,
  }
}

function appendLog(report: HealthReport): void {
  try {
    fs.mkdirSync(REPORTS_DIR, { recursive: true })
    fs.appendFileSync(REPORT_LOG, JSON.stringify(report) + "\n", { mode: 0o600 })
  } catch (e) {
    log.warn("bug-reporter", `append log failed: ${(e as Error).message}`)
  }
}

function writeLatest(report: HealthReport): void {
  try {
    fs.mkdirSync(REPORTS_DIR, { recursive: true })
    fs.writeFileSync(LATEST, JSON.stringify(report, null, 2), { mode: 0o600 })
  } catch (e) {
    log.warn("bug-reporter", `write latest failed: ${(e as Error).message}`)
  }
}

/** Build, persist, and return the report. */
export function recordReport(summary: HealthSummary): HealthReport {
  const r = buildReport(summary)
  appendLog(r)
  writeLatest(r)
  log.info("bug-reporter", `report saved: ${r.summary.findings} finding(s), ${r.summary.fixed} fixed`)
  return r
}

/** Read the most recent report (or null). */
export function getLatestReport(): HealthReport | null {
  try {
    if (!fs.existsSync(LATEST)) return null
    return JSON.parse(fs.readFileSync(LATEST, "utf8")) as HealthReport
  } catch {
    return null
  }
}

/** Read last N reports from the log. */
export function getRecentReports(limit = 10): HealthReport[] {
  try {
    if (!fs.existsSync(REPORT_LOG)) return []
    const lines = fs.readFileSync(REPORT_LOG, "utf8").split(/\r?\n/).filter(Boolean)
    return lines
      .slice(-limit)
      .reverse()
      .map((l) => { try { return JSON.parse(l) as HealthReport } catch { return null } })
      .filter((r): r is HealthReport => Boolean(r))
  } catch { return [] }
}

/** Human-friendly summary text (for `nexus update` UI). */
export function formatForNUI(report: HealthReport): string {
  const lines: string[] = []
  lines.push(`NEXUS autofarm — health report @ ${report.iso}`)
  lines.push(`  version: ${report.nexusVersion}  device: ${report.device.hostname} (${report.device.os}/${report.device.arch})`)
  lines.push(`  findings: ${report.summary.findings}  fixed: ${report.summary.fixed}  needs user: ${report.summary.needsUser}  failed: ${report.summary.failed}`)
  lines.push("")
  if (report.items.length === 0) {
    lines.push("  ✓ all green — no action required")
  } else {
    for (const it of report.items) {
      const icon = it.status === "applied" ? "✓" : it.status === "needs-user" ? "!" : it.status === "failed" ? "✗" : "·"
      lines.push(`  ${icon} [${it.severity}/${it.category}] ${it.title}`)
      lines.push(`     ${it.fixMessage}`)
      if (it.userAction) lines.push(`     → ${it.userAction}`)
    }
  }
  if (report.recommendations.length > 0) {
    lines.push("")
    lines.push("  recommendations:")
    for (const r of report.recommendations) lines.push(`    - ${r}`)
  }
  if (report.updateRecommended) {
    lines.push("")
    lines.push("  ⚠ nexus update recommended to address remaining issues")
  }
  return lines.join("\n")
}

export function latestReportPath(): string {
  return LATEST
}

export function reportLogPath(): string {
  return REPORT_LOG
}
