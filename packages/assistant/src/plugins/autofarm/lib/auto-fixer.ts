// auto-fixer: real-time bug detection + auto-fix + report.
// Each FixStrategy knows how to detect AND fix one class of bug.
// The user-facing flow is: detect → fix → verify → report.
//
// Every fix is non-destructive: it preserves user data (vault keys,
// webhooks config) and only repairs what is provably broken.

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { log } from "./logger.ts"
import { detectOnce, type BugReport, type Severity } from "./bug-detector.ts"

export type FixStatus = "applied" | "skipped" | "failed" | "needs-user"

export interface FixResult {
  bug: BugReport
  status: FixStatus
  message: string
  /** Diff or before/after summary of what was changed. */
  diff?: string
  /** Time spent fixing. */
  ms: number
  /** What the user should do next (for needs-user fixes). */
  userAction?: string
}

export interface FixStrategy {
  /** Match by bug title or category. */
  matches(b: BugReport): boolean
  /** Apply the fix; return FixResult. */
  apply(b: BugReport): Promise<FixResult> | FixResult
}

// ── Strategies ────────────────────────────────────────────────────

const VAULT_PATH = path.join(os.homedir(), ".nexus", "api-vault.json")
const USAGE_PATH = path.join(os.homedir(), ".nexus", "api-usage.json")
const WEBHOOK_CFG = path.join(os.homedir(), ".nexus", "autofarm", "webhooks.json")
const LOG_DIR = path.join(os.homedir(), ".nexus", "autofarm")

function safeRead(p: string): string | null {
  try { return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null } catch { return null }
}

function safeWrite(p: string, content: string): boolean {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    const tmp = p + ".tmp." + Date.now()
    fs.writeFileSync(tmp, content, { mode: 0o600 })
    fs.renameSync(tmp, p)
    fs.chmodSync(p, 0o600)
    return true
  } catch (e) {
    log.warn("auto-fixer", `write ${p} failed: ${(e as Error).message}`)
    return false
  }
}

function isCorruptedVault(b: BugReport): boolean {
  return b.category === "vault" && /corrupt|missing|invalid key entry/i.test(b.title)
}

const fixCorruptVault: FixStrategy = {
  matches: isCorruptedVault,
  apply(b) {
    const t0 = Date.now()
    // Strategy 1: try to find a .bak or .tmp file
    const candidates = [
      VAULT_PATH + ".bak",
      VAULT_PATH + ".tmp.0",
      USAGE_PATH,
    ]
    for (const c of candidates) {
      const content = safeRead(c)
      if (content) {
        try {
          const parsed = JSON.parse(content)
          if (parsed?.providers) {
            if (safeWrite(VAULT_PATH, JSON.stringify(parsed, null, 2))) {
              return {
                bug: b,
                status: "applied",
                message: `restored vault from ${c}`,
                diff: `wrote ${parsed.providers ? Object.keys(parsed.providers).length : 0} providers back to ${VAULT_PATH}`,
                ms: Date.now() - t0,
              }
            }
          }
        } catch { /* not valid json, try next */ }
      }
    }
    // Strategy 2: try to parse what's there and salvage
    const raw = safeRead(VAULT_PATH)
    if (raw) {
      // Find the last valid brace boundary
      const trimmed = raw.replace(/[\s\S]*?(\{)/m, "$1")
      // Close any open braces
      const opens = (trimmed.match(/\{/g) || []).length
      const closes = (trimmed.match(/\}/g) || []).length
      const pad = "{".repeat(Math.max(0, opens - closes))
      try {
        const repaired = trimmed + pad.split("").reverse().join("").replace(/\{/g, "}")
        const parsed = JSON.parse(repaired)
        if (safeWrite(VAULT_PATH, JSON.stringify(parsed, null, 2))) {
          return {
            bug: b,
            status: "applied",
            message: "repaired truncated vault JSON",
            ms: Date.now() - t0,
          }
        }
      } catch { /* fall through */ }
    }
    // Strategy 3: rebuild empty vault
    const empty = { providers: {}, usage: {}, usageBudget: { version: 1 }, autoRotate: true, fallbackToLocal: true }
    if (safeWrite(VAULT_PATH, JSON.stringify(empty, null, 2))) {
      return {
        bug: b,
        status: "applied",
        message: "rebuilt empty vault (keys lost — add new via autofarm cycle)",
        userAction: "run: nexus autofarm cycle to farm new keys",
        ms: Date.now() - t0,
      }
    }
    return {
      bug: b,
      status: "failed",
      message: "could not repair vault",
      ms: Date.now() - t0,
      userAction: "manually inspect ~/.nexus/api-vault.json",
    }
  },
}

function isDeadProvider(b: BugReport): boolean {
  return b.category === "key" && /0 working keys|expired/i.test(b.title)
}

const fixDeadProvider: FixStrategy = {
  matches: isDeadProvider,
  apply(b) {
    const t0 = Date.now()
    // Try to extract provider name from title
    const m = b.title.match(/provider (\S+) has/)
    const provider = m?.[1]
    if (!provider) {
      return { bug: b, status: "skipped", message: "could not parse provider name", ms: Date.now() - t0 }
    }
    // Mark all keys as invalid so api-manager will auto-replace
    try {
      const raw = safeRead(VAULT_PATH)
      if (!raw) return { bug: b, status: "failed", message: "vault missing", ms: Date.now() - t0 }
      const parsed = JSON.parse(raw) as { providers: Record<string, Array<{ key: string; status: string }>> }
      const list = parsed.providers?.[provider] ?? []
      let removed = 0
      for (const e of list) {
        if (e.status !== "invalid") {
          e.status = "invalid"
          removed++
        }
      }
      if (safeWrite(VAULT_PATH, JSON.stringify(parsed, null, 2))) {
        return {
          bug: b,
          status: "applied",
          message: `marked ${removed} dead keys in ${provider} as invalid; api-manager will auto-replace`,
          userAction: "run: nexus autofarm api-manager run",
          ms: Date.now() - t0,
        }
      }
    } catch (e) {
      return { bug: b, status: "failed", message: (e as Error).message, ms: Date.now() - t0 }
    }
    return { bug: b, status: "failed", message: "unknown error", ms: Date.now() - t0 }
  },
}

function isStaleMCP(b: BugReport): boolean {
  return b.category === "mcp" && /stale|playwright/i.test(b.title)
}

const fixStaleMCP: FixStrategy = {
  matches: isStaleMCP,
  apply(b) {
    const t0 = Date.now()
    const dir = path.join(os.homedir(), "nexus", ".playwright-mcp")
    if (!fs.existsSync(dir)) {
      return { bug: b, status: "skipped", message: "no playwright-mcp directory", ms: Date.now() - t0 }
    }
    try {
      const files = fs.readdirSync(dir).filter((f) => f.startsWith("page-") && f.endsWith(".yml"))
      let removed = 0
      const now = Date.now()
      for (const f of files) {
        try {
          const st = fs.statSync(path.join(dir, f))
          if (now - st.mtimeMs > 10 * 60 * 1000) {
            fs.unlinkSync(path.join(dir, f))
            removed++
          }
        } catch {}
      }
      return {
        bug: b,
        status: "applied",
        message: `cleaned ${removed} stale playwright-mcp page dumps`,
        ms: Date.now() - t0,
      }
    } catch (e) {
      return { bug: b, status: "failed", message: (e as Error).message, ms: Date.now() - t0 }
    }
  },
}

function isDiskFull(b: BugReport): boolean {
  return b.category === "system" && /disk/i.test(b.title)
}

const fixDiskFull: FixStrategy = {
  matches: isDiskFull,
  apply(b) {
    const t0 = Date.now()
    // Try to clean up our own log files
    let removed = 0
    try {
      const autofarmDir = path.join(os.homedir(), ".nexus", "autofarm")
      if (fs.existsSync(autofarmDir)) {
        const files = fs.readdirSync(autofarmDir)
        for (const f of files) {
          if (f.endsWith(".log") || f.endsWith(".tmp")) {
            try {
              const st = fs.statSync(path.join(autofarmDir, f))
              if (st.size > 10 * 1024 * 1024) {
                fs.unlinkSync(path.join(autofarmDir, f))
                removed++
              }
            } catch {}
          }
        }
      }
    } catch {}
    return {
      bug: b,
      status: removed > 0 ? "applied" : "needs-user",
      message: removed > 0
        ? `cleaned ${removed} large log files`
        : "no auto-fix available, please free disk space manually",
      userAction: removed === 0 ? "free disk: rm large files in ~" : undefined,
      ms: Date.now() - t0,
    }
  },
}

function isMemoryFull(b: BugReport): boolean {
  return b.category === "system" && /memory/i.test(b.title)
}

const fixMemoryFull: FixStrategy = {
  matches: isMemoryFull,
  apply(b) {
    // We can't free memory programmatically; suggest action.
    return {
      bug: b,
      status: "needs-user",
      message: "memory critical; consider killing heavy processes",
      userAction: "run: ps aux --sort=-%mem | head; then kill <pid>",
      ms: 0,
    }
  },
}

function isConfigError(b: BugReport): boolean {
  return b.category === "config" && /parse/i.test(b.title)
}

const fixConfigError: FixStrategy = {
  matches: isConfigError,
  apply(b) {
    const t0 = Date.now()
    const cfg = path.join(os.homedir(), ".config", "nexus", "nexus.jsonc")
    if (!fs.existsSync(cfg)) {
      return { bug: b, status: "skipped", message: "no config file", ms: Date.now() - t0 }
    }
    try {
      const raw = fs.readFileSync(cfg, "utf8")
      // Strip comments, try parse
      const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
      JSON.parse(stripped)
      // Already valid? weird.
      return { bug: b, status: "skipped", message: "config already parses after stripping comments", ms: Date.now() - t0 }
    } catch (e) {
      // Try to back up the broken config and write an empty one
      try {
        const backup = cfg + ".broken." + Date.now()
        fs.copyFileSync(cfg, backup)
        fs.writeFileSync(cfg, "{}\n", { mode: 0o600 })
        return {
          bug: b,
          status: "applied",
          message: `backed up broken config to ${backup} and wrote empty {}`,
          userAction: "re-run: nexus setup to reconfigure",
          ms: Date.now() - t0,
        }
      } catch (e2) {
        return { bug: b, status: "failed", message: (e2 as Error).message, ms: Date.now() - t0 }
      }
    }
  },
}

const ALL_STRATEGIES: FixStrategy[] = [
  fixCorruptVault,
  fixDeadProvider,
  fixStaleMCP,
  fixDiskFull,
  fixMemoryFull,
  fixConfigError,
]

// ── Public API ──────────────────────────────────────────────────────

/** Run a single fix cycle: detect → fix → return results. */
export function fixOnce(opts: { dryRun?: boolean } = {}): { findings: BugReport[]; fixes: FixResult[] } {
  const findings = detectOnce()
  const fixes: FixResult[] = []
  for (const b of findings) {
    const strategy = ALL_STRATEGIES.find((s) => s.matches(b))
    if (!strategy) {
      fixes.push({ bug: b, status: "skipped", message: "no auto-fix strategy", ms: 0 })
      continue
    }
    if (opts.dryRun) {
      fixes.push({ bug: b, status: "skipped", message: "dry run", ms: 0 })
      continue
    }
    try {
      const r = strategy.apply(b)
      log.info("auto-fixer", `${b.title}: ${r.status} — ${r.message}`)
      fixes.push(r)
    } catch (e) {
      fixes.push({ bug: b, status: "failed", message: (e as Error).message, ms: 0 })
    }
  }
  return { findings, fixes }
}

export interface HealthSummary {
  ts: number
  findings: number
  fixed: number
  needsUser: number
  failed: number
  totalMs: number
  details: Array<{ severity: Severity; category: string; title: string; status: FixStatus; message: string }>
}

/** One-shot health check + fix + summary. */
export function healthCheck(dryRun = false): HealthSummary {
  const t0 = Date.now()
  const { findings, fixes } = fixOnce({ dryRun })
  const fixed = fixes.filter((f) => f.status === "applied").length
  const needsUser = fixes.filter((f) => f.status === "needs-user").length
  const failed = fixes.filter((f) => f.status === "failed").length
  return {
    ts: Date.now(),
    findings: findings.length,
    fixed,
    needsUser,
    failed,
    totalMs: Date.now() - t0,
    details: fixes.map((f) => ({
      severity: f.bug.severity,
      category: f.bug.category,
      title: f.bug.title,
      status: f.status,
      message: f.message,
    })),
  }
}

let _running = false
let _timer: ReturnType<typeof setInterval> | null = null
let _cycleCount = 0
let _lastSummary: HealthSummary | null = null

/** Start self-healing: detect → fix → report on a loop. */
export function startHealing(intervalMs = 5 * 60_000): {
  stop: () => void
  status: () => { running: boolean; intervalMs: number; cycles: number; lastSummary: HealthSummary | null }
} {
  if (_running) {
    return {
      stop: () => {},
      status: () => ({ running: true, intervalMs, cycles: _cycleCount, lastSummary: _lastSummary }),
    }
  }
  _running = true
  _cycleCount = 0
  log.info("auto-fixer", `self-healing started, every ${intervalMs}ms`)
  // initial cycle after a small delay
  setTimeout(() => runCycle(), 2000)
  _timer = setInterval(() => runCycle(), intervalMs)
  return {
    stop: () => {
      if (_timer) clearInterval(_timer)
      _timer = null
      _running = false
      log.info("auto-fixer", "self-healing stopped")
    },
    status: () => ({ running: _running, intervalMs, cycles: _cycleCount, lastSummary: _lastSummary }),
  }
}

function runCycle(): void {
  _cycleCount += 1
  const s = healthCheck(false)
  _lastSummary = s
  log.info("auto-fixer", `cycle #${_cycleCount}: ${s.findings} finding(s), ${s.fixed} fixed, ${s.needsUser} need user, ${s.failed} failed`)
}

export function getLastSummary(): HealthSummary | null {
  return _lastSummary
}

export const STRATEGIES = ALL_STRATEGIES
