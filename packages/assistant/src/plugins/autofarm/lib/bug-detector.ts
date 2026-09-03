// bug-detector: real-time bug & health monitor for NEXUS.
// Watches: vault corruption, key failures, MCP disconnects, error spikes,
// disk space, memory leaks, etc. Sends findings to webhook + dashboard.
// Designed to run continuously on every device without any login.

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { log } from "./logger.ts"
import { sendWebhook } from "./webhooks.ts"

export type Severity = "info" | "warn" | "error" | "critical"

export interface BugReport {
  id: string
  ts: number
  severity: Severity
  category: "vault" | "key" | "mcp" | "system" | "network" | "config"
  title: string
  detail: string
  /** Suggested fix the user can run. */
  suggestedFix?: string
  /** NEXUS version when detected. */
  nexusVersion?: string
  /** Device fingerprint. */
  device?: DeviceFingerprint
  /** True if this report was already sent. */
  notified?: boolean
}

export interface DeviceFingerprint {
  hostname: string
  os: string
  arch: string
  uptime: number
  nodeVersion: string
  nexusPath: string
  workspace: string
}

const BUG_LOG = path.join(os.homedir(), ".nexus", "autofarm", "bugs.jsonl")
const DEVICE_PATH = path.join(os.homedir(), ".nexus", "autofarm", "device.json")
const NEXUS_VERSION = "0.1.66" // read from VERSION file at runtime

let _idCounter = 0
function nextId(): string {
  _idCounter += 1
  return `bug_${Date.now().toString(36)}_${_idCounter}`
}

function fingerprint(): DeviceFingerprint {
  return {
    hostname: os.hostname(),
    os: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    uptime: os.uptime(),
    nodeVersion: process.version,
    nexusPath: process.cwd(),
    workspace: os.homedir(),
  }
}

function appendBug(b: BugReport): void {
  try {
    fs.mkdirSync(path.dirname(BUG_LOG), { recursive: true })
    fs.appendFileSync(BUG_LOG, JSON.stringify(b) + "\n", { mode: 0o600 })
  } catch (e) {
    log.warn("bug-detector", `append failed: ${(e as Error).message}`)
  }
}

function notify(b: BugReport): void {
  const kind = b.severity === "critical" || b.severity === "error" ? "system-error" : "anomaly-detected"
  void sendWebhook({
    kind,
    message: `${b.severity.toUpperCase()}: ${b.title}`,
    data: { ...b, device: b.device ?? fingerprint() },
  })
}

function report(severity: Severity, category: BugReport["category"], title: string, detail: string, fix?: string): BugReport {
  const b: BugReport = {
    id: nextId(),
    ts: Date.now(),
    severity,
    category,
    title,
    detail,
    suggestedFix: fix,
    nexusVersion: NEXUS_VERSION,
    device: fingerprint(),
  }
  appendBug(b)
  notify(b)
  return b
}

// ── Individual checks ──────────────────────────────────────────────

function checkVault(): BugReport[] {
  const out: BugReport[] = []
  const vp = path.join(os.homedir(), ".nexus", "api-vault.json")
  if (!fs.existsSync(vp)) {
    out.push(report("critical", "vault", "vault file missing", `${vp} does not exist`, "run: nexus autofarm encrypt (will create from empty state)"))
    return out
  }
  try {
    const raw = fs.readFileSync(vp, "utf8")
    const parsed = JSON.parse(raw) as { providers?: unknown; usage?: unknown }
    if (!parsed.providers || typeof parsed.providers !== "object") {
      out.push(report("critical", "vault", "vault corrupted (no providers)", `vault at ${vp} has no providers object`, "run: nexus autofarm fix (will attempt auto-repair)"))
    }
    // Check each provider's keys are valid
    for (const [p, ks] of Object.entries(parsed.providers as Record<string, unknown[]>)) {
      if (!Array.isArray(ks)) {
        out.push(report("error", "vault", `vault provider ${p} is not array`, `entries should be array, got ${typeof ks}`))
        continue
      }
      for (const e of ks) {
        const ent = e as { key?: string; status?: string }
        if (!ent.key || typeof ent.key !== "string" || ent.key.length < 5) {
          out.push(report("error", "vault", `vault ${p} has invalid key entry`, `key=${JSON.stringify(ent.key)}`))
        }
      }
    }
  } catch (e) {
    out.push(report("critical", "vault", "vault parse error", (e as Error).message, "delete corrupted file or restore from backup"))
  }
  return out
}

function checkKeys(): BugReport[] {
  const out: BugReport[] = []
  const vp = path.join(os.homedir(), ".nexus", "api-vault.json")
  if (!fs.existsSync(vp)) return out
  try {
    const parsed = JSON.parse(fs.readFileSync(vp, "utf8")) as { providers: Record<string, Array<{ key: string; status: string; failures?: number; added?: string }>> }
    for (const [p, keys] of Object.entries(parsed.providers)) {
      const failed = keys.filter((k) => k.status === "invalid" || (k.failures ?? 0) >= 3).length
      const total = keys.length
      if (total > 0 && failed === total) {
        out.push(report("critical", "key", `provider ${p} has 0 working keys`, `${failed}/${total} keys failed`, "run: nexus autofarm cycle (will try to add new)"))
      } else if (failed > total * 0.5) {
        out.push(report("warn", "key", `provider ${p} has many failed keys`, `${failed}/${total} keys invalid`, "consider rotating"))
      }
    }
  } catch {}
  return out
}

function checkSystem(): BugReport[] {
  const out: BugReport[] = []
  // Disk space
  try {
    // check statvfs on home dir
    const { execSync } = require("node:child_process") as typeof import("node:child_process")
    const out_ = execSync(`df -k ${os.homedir()} | tail -1`).toString().trim().split(/\s+/)
    const usedPct = parseInt(out_[4]?.replace("%", "") ?? "0", 10)
    if (usedPct > 90) {
      out.push(report("critical", "system", "disk almost full", `disk ${usedPct}% used on ${os.homedir()}`))
    } else if (usedPct > 80) {
      out.push(report("warn", "system", "disk space low", `disk ${usedPct}% used`))
    }
  } catch {}
  // Memory pressure (Linux)
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process")
    const mem = execSync("free -m | grep Mem").toString().trim().split(/\s+/)
    const total = parseInt(mem[1] ?? "0", 10)
    const used = parseInt(mem[2] ?? "0", 10)
    if (total > 0 && used / total > 0.95) {
      out.push(report("critical", "system", "memory critical", `using ${used}MB / ${total}MB (${Math.round(used / total * 100)}%)`))
    }
  } catch {}
  return out
}

function checkMCP(): BugReport[] {
  // We don't have direct MCP subprocess introspection here, but we
  // can check the .playwright-mcp output dir for stale pages.
  const out: BugReport[] = []
  const dir = path.join(os.homedir(), "nexus", ".playwright-mcp")
  if (!fs.existsSync(dir)) return out
  try {
    const files = fs.readdirSync(dir).filter((f) => f.startsWith("page-") && f.endsWith(".yml"))
    const now = Date.now()
    const stale = files.filter((f) => {
      try {
        const st = fs.statSync(path.join(dir, f))
        return now - st.mtimeMs > 10 * 60 * 1000 // 10 min
      } catch { return false }
    })
    if (stale.length > 5) {
      out.push(report("warn", "mcp", `playwright mcp has ${stale.length} stale page dumps`, `consider restarting browser session`))
    }
  } catch {}
  return out
}

function checkConfig(): BugReport[] {
  const out: BugReport[] = []
  const cfg = path.join(os.homedir(), ".config", "nexus", "nexus.jsonc")
  if (fs.existsSync(cfg)) {
    try {
      JSON.parse(fs.readFileSync(cfg, "utf8").replace(/\/\/.*$/gm, ""))
    } catch (e) {
      out.push(report("warn", "config", "config parse error", (e as Error).message))
    }
  }
  return out
}

// ── Public API ──────────────────────────────────────────────────────

/** Run all checks once. Returns list of new reports. */
export function detectOnce(): BugReport[] {
  return [
    ...checkVault(),
    ...checkKeys(),
    ...checkSystem(),
    ...checkMCP(),
    ...checkConfig(),
  ]
}

let _running = false
let _timer: ReturnType<typeof setInterval> | null = null

/** Start continuous monitoring (every intervalMs). Cross-device safe. */
export function startMonitoring(intervalMs = 60_000): { stop: () => void; status: () => { running: boolean; intervalMs: number; bugsReported: number } } {
  if (_running) {
    return {
      stop: () => {},
      status: () => ({ running: true, intervalMs, bugsReported: _idCounter }),
    }
  }
  _running = true
  _idCounter = 0
  // Persist device fingerprint on first start
  try {
    fs.mkdirSync(path.dirname(DEVICE_PATH), { recursive: true })
    fs.writeFileSync(DEVICE_PATH, JSON.stringify(fingerprint(), null, 2))
  } catch {}
  log.info("bug-detector", `monitoring started, every ${intervalMs}ms`)
  // initial run
  setTimeout(() => {
    const initial = detectOnce()
    log.info("bug-detector", `initial check: ${initial.length} finding(s)`)
  }, 1000)
  _timer = setInterval(() => {
    const findings = detectOnce()
    if (findings.length > 0) {
      log.warn("bug-detector", `${findings.length} new finding(s) at ${new Date().toISOString()}`)
    }
  }, intervalMs)
  return {
    stop: () => {
      if (_timer) clearInterval(_timer)
      _timer = null
      _running = false
      log.info("bug-detector", "monitoring stopped")
    },
    status: () => ({ running: _running, intervalMs, bugsReported: _idCounter }),
  }
}

/** Get the recent bug log. */
export function getRecentBugs(limit = 20): BugReport[] {
  try {
    if (!fs.existsSync(BUG_LOG)) return []
    const lines = fs.readFileSync(BUG_LOG, "utf8").split(/\r?\n/).filter(Boolean)
    return lines
      .slice(-limit)
      .reverse()
      .map((l) => {
        try { return JSON.parse(l) as BugReport } catch { return null }
      })
      .filter((b): b is BugReport => Boolean(b))
  } catch { return [] }
}

/** Read this device's fingerprint. */
export function thisDevice(): DeviceFingerprint {
  return fingerprint()
}

/** Read the most-recently-recorded bugs across devices (if shared beacon). */
export function recentAcrossDevices(limit = 50): BugReport[] {
  // The beacon format is a JSONL of {device, bug} pairs. We read from the
  // canonical local path; cross-device sharing is a future enhancement.
  return getRecentBugs(limit)
}

export function bugLogPath(): string {
  return BUG_LOG
}

export function devicePath(): string {
  return DEVICE_PATH
}
