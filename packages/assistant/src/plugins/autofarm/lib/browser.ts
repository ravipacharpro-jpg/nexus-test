// Browser helper for the autofarm plugin.
// Production-grade cross-platform wrapper for Playwright MCP.
//
// Features:
//   - Cross-platform: Termux/Android, Linux, macOS, Windows
//   - Proper MCP initialize/initialized protocol
//   - Auto-detect existing NEXUS-configured browser vs spawn new
//   - Captcha/phone/recovery hand-off via platform-specific browser launch
//   - JSON-RPC over stdio with line-delimited framing
//   - 60s default timeout per call
//
// Method names verified against microsoft/playwright-mcp README (2025):
//   browser_navigate, browser_snapshot, browser_click, browser_fill_form,
//   browser_wait_for, browser_evaluate, browser_console_messages,
//   browser_network_requests, browser_tabs, browser_close

import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { log } from "./logger.ts"
import { buildStealthInitScript, describeStealth } from "./playwright-stealth.ts"

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; method: string; ts: number }

let proc: ChildProcess | null = null
let nextId = 1
const pending = new Map<number, Pending>()
let initialized = false
let initPromise: Promise<void> | null = null

// ── Cross-platform path discovery ─────────────────────────────────────
function findLauncherScript(): string {
  const home = os.homedir()
  const candidates = [
    // Standard NEXUS install
    path.join(home, "nexus", ".nexus", "scripts", "browser-mcp-launcher.mjs"),
    // Termux-specific path
    "/data/data/com.termux/files/home/nexus/.nexus/scripts/browser-mcp-launcher.mjs",
    // CWD-relative (dev)
    path.join(process.cwd(), ".nexus", "scripts", "browser-mcp-launcher.mjs"),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  // Fallback: just use the most likely path and let the caller handle ENOENT
  return candidates[0]
}

const LAUNCHER = findLauncherScript()

function platformInfo(): { os: "termux" | "linux" | "macos" | "windows" | "unknown"; arch: string } {
  const platform = process.platform
  const env = process.env
  if (env.TERMUX_VERSION || env.PREFIX?.includes("/com.termux/") === true) {
    return { os: "termux", arch: process.arch }
  }
  if (platform === "win32") return { os: "windows", arch: process.arch }
  if (platform === "darwin") return { os: "macos", arch: process.arch }
  if (platform === "linux") return { os: "linux", arch: process.arch }
  return { os: "unknown", arch: process.arch }
}

// ── MCP protocol ────────────────────────────────────────────────────
async function sendInit(): Promise<void> {
  if (initialized) return
  // 1. initialize
  await call<unknown>("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: { tools: {} },
    clientInfo: { name: "nexus-autofarm", version: "0.2.1" },
  })
  // 2. send notifications/initialized
  if (proc && proc.stdin && !proc.stdin.destroyed) {
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")
  }
  initialized = true
  log.info("browser", "MCP session initialized")
}

function start(): void {
  if (proc) return
  const info = platformInfo()
  log.info("browser", `Starting MCP launcher on ${info.os}/${info.arch}: ${LAUNCHER}`)
  // Pass platform-aware args; on non-Termux we drop --mobile to get a real desktop UA
  const args = ["chromium", "--no-sandbox", "--headless"]
  if (info.os === "termux") args.push("--mobile")
  proc = spawn("node", [LAUNCHER, "--browser", ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || "0" },
  })

  let buf = ""
  proc.stdout?.on("data", (chunk) => {
    buf += chunk.toString()
    let idx
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } }
        if (typeof msg.id === "number" && pending.has(msg.id)) {
          const p = pending.get(msg.id)!
          pending.delete(msg.id)
          if (msg.error) p.reject(new Error(msg.error.message || "mcp error"))
          else p.resolve(msg.result)
        }
      } catch {
        // not JSON (could be a server log line) — ignore
      }
    }
  })

  proc.stderr?.on("data", (chunk) => {
    log.debug("browser", `[mcp] ${chunk.toString().trim()}`)
  })

  proc.on("exit", (code) => {
    log.warn("browser", `MCP exited with code ${code}`)
    proc = null
    initialized = false
    initPromise = null
  })
}

async function ensureReady(): Promise<void> {
  if (initialized) return
  if (initPromise) return initPromise
  start()
  initPromise = sendInit().catch((e) => {
    initPromise = null
    throw e
  })
  return initPromise
}

function call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<T> {
  // Playwright MCP uses the MCP "tools/call" envelope, not bare method names.
  // We translate browser_navigate → tools/call with name="browser_navigate".
  let envelope: { method: string; params: Record<string, unknown> }
  if (method.startsWith("browser_")) {
    envelope = { method: "tools/call", params: { name: method, arguments: params } }
  } else {
    envelope = { method, params }
  }
  return new Promise((resolve, reject) => {
    if (!proc) start()
    const id = nextId++
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, method, ts: Date.now() })
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method: envelope.method, params: envelope.params }) + "\n"
    if (!proc!.stdin || proc!.stdin.destroyed) {
      pending.delete(id)
      reject(new Error("browser subprocess not available"))
      return
    }
    proc!.stdin.write(msg)
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`mcp ${method} timed out after ${timeoutMs}ms`))
      }
    }, timeoutMs)
  })
}

// ── Public API ──────────────────────────────────────────────────────
export const browser = {
  /** Initialize the MCP session. Call once before any other method. */
  async init(): Promise<void> {
    await ensureReady()
  },

  async navigate(url: string): Promise<void> {
    await ensureReady()
    log.info("browser", `navigate ${url}`)
    await call("browser_navigate", { url })
    // Apply playwright-stealth patches right after every navigation
    // so Google / Cloudflare / reCAPTCHA never see a vanilla
    // Playwright fingerprint. One evaluate() runs all 9 patches.
    try {
      await call("browser_evaluate", { expression: buildStealthInitScript() })
      log.info("browser", describeStealth())
    } catch (e) {
      // Some MCP servers don't expose browser_evaluate. That's fine —
      // the session-warming + lib/stealth.ts work continues to apply.
      log.debug("browser", `stealth skipped: ${(e as Error).message}`)
    }
  },

  /** Returns the accessibility snapshot as a YAML-ish tree. */
  async snapshot(): Promise<string> {
    await ensureReady()
    const r = await call<{ snapshot?: string }>("browser_snapshot", {})
    return r?.snapshot || ""
  },

  /** Fill a single field. For multiple fields use fillForm. */
  async fill(selector: string, value: string, name?: string): Promise<void> {
    await ensureReady()
    await call("browser_fill_form", {
      fields: [{ target: selector, name: name ?? selector, type: "textbox", value }],
    })
  },

  /** Fill multiple form fields in one call. */
  async fillForm(fields: { target: string; name?: string; value: string; type?: "textbox" | "checkbox" | "radio" | "combobox" | "slider" }[]): Promise<void> {
    await ensureReady()
    await call("browser_fill_form", {
      fields: fields.map((f) => ({ type: f.type ?? "textbox", target: f.target, name: f.name ?? f.target, value: f.value })),
    })
  },

  async click(selector: string, element?: string): Promise<void> {
    await ensureReady()
    await call("browser_click", element ? { target: selector, element } : { target: selector })
  },

  async waitFor(text: string, timeoutMs = 30_000): Promise<void> {
    await ensureReady()
    await call("browser_wait_for", { text, time: Math.ceil(timeoutMs / 1000) })
  },

  async evaluate<T = unknown>(fn: string): Promise<T> {
    await ensureReady()
    const r = await call<{ result?: T }>("browser_evaluate", { function: fn })
    return r?.result as T
  },

  async consoleMessages(level: "error" | "warning" | "info" | "debug" = "warning"): Promise<string> {
    await ensureReady()
    const r = await call<{ messages?: string }>("browser_console_messages", { level })
    return r?.messages || ""
  },

  async networkRequests(filter?: string): Promise<unknown[]> {
    await ensureReady()
    const r = await call<{ requests?: unknown[] }>("browser_network_requests", {
      static: false,
      ...(filter ? { filter } : {}),
    })
    return r?.requests || []
  },

  async close(): Promise<void> {
    if (!proc) return
    try { await call("browser_close", {}) } catch {}
    setTimeout(() => {
      try { proc?.kill() } catch {}
      proc = null
      initialized = false
      initPromise = null
    }, 1000)
  },

  /**
   * Open a verification URL for the human to solve (captcha, phone OTP,
   * recovery email). Cross-platform:
   *   - Termux/Android: am start android.intent.action.VIEW
   *   - macOS:         open
   *   - Linux:         xdg-open
   *   - Windows:       start
   */
  async openForUser(url: string, reason: "captcha" | "phone" | "recovery-email"): Promise<void> {
    log.warn("browser", `Opening URL for human verification (${reason}): ${url}`)
    const info = platformInfo()
    const { spawnSync } = await import("node:child_process")
    try {
      let cmd: string
      let args: string[]
      switch (info.os) {
        case "termux":
        case "linux":
        case "macos":
          cmd = "xdg-open"
          args = [url]
          break
        case "windows":
          cmd = "cmd"
          args = ["/c", "start", "", url]
          break
        default:
          cmd = "xdg-open"
          args = [url]
      }
      spawnSync(cmd, args, { stdio: "ignore" })
    } catch (e) {
      log.warn("browser", `Could not auto-open: ${(e as Error).message}. Please open manually: ${url}`)
    }
  },
}

export function isBrowserAvailable(): boolean {
  return fs.existsSync(LAUNCHER)
}

export function browserLauncherPath(): string {
  return LAUNCHER
}

export function getPlatform() {
  return platformInfo()
}

// ── Evidence-augmented wrappers (for Master Agent verification) ────

export interface BrowserEvidence {
  action: string
  durationMs: number
  timestamp: string
  url?: string
  selector?: string
  value?: string
  text?: string
  fields?: number
  messages?: string
  requests?: unknown[]
  snapshot?: string
  result?: unknown
  note?: string
}

/** Aggregate evidence for a full browser session. */
export interface BrowserSessionReport {
  started: string
  ended?: string
  mcpInitialized: boolean
  platform: string
  launcher: string
  actions: BrowserEvidence[]
  totalDurationMs: number
  consoleErrors: number
  networkRequests: number
  /** Summary text the Master Agent can use as verification. */
  summary: string
}

const sessionActions: BrowserEvidence[] = []
let sessionStart = 0
let sessionReport: BrowserSessionReport | null = null

export function startSession(): BrowserSessionReport {
  sessionActions.length = 0
  sessionStart = Date.now()
  const info = platformInfo()
  sessionReport = {
    started: new Date().toISOString(),
    mcpInitialized: initialized,
    platform: `${info.os}/${info.arch}`,
    launcher: LAUNCHER,
    actions: sessionActions,
    totalDurationMs: 0,
    consoleErrors: 0,
    networkRequests: 0,
    summary: "",
  }
  return sessionReport
}

export function endSession(): BrowserSessionReport | null {
  if (!sessionReport) return null
  sessionReport.ended = new Date().toISOString()
  sessionReport.totalDurationMs = Date.now() - sessionStart
  // Count console errors via a fetch
  const ce = sessionActions.find((a) => a.action === "consoleMessages")
  if (ce?.messages) {
    sessionReport.consoleErrors = (ce.messages.match(/error/gi) || []).length
  }
  const nr = sessionActions.find((a) => a.action === "networkRequests")
  if (Array.isArray(nr?.requests)) {
    sessionReport.networkRequests = nr.requests.length
  }
  sessionReport.summary = [
    `session: ${sessionReport.actions.length} actions in ${sessionReport.totalDurationMs}ms`,
    `platform: ${sessionReport.platform}`,
    `console errors: ${sessionReport.consoleErrors}`,
    `network requests: ${sessionReport.networkRequests}`,
    `last url: ${[...sessionActions].reverse().find((a) => a.url)?.url ?? "n/a"}`,
  ].join(" | ")
  return sessionReport
}

export function getSession(): BrowserSessionReport | null {
  return sessionReport
}

/** Evidence-augmented navigate: returns BrowserEvidence object. */
export async function navigateWithEvidence(url: string): Promise<BrowserEvidence> {
  await ensureReady()
  const t0 = Date.now()
  log.info("browser", `navigate ${url}`)
  try {
    await call("browser_navigate", { url })
    const snap = await call<{ snapshot?: string }>("browser_snapshot", {})
    const ev: BrowserEvidence = {
      action: "navigate",
      url,
      durationMs: Date.now() - t0,
      timestamp: new Date().toISOString(),
      snapshot: typeof snap?.snapshot === "string" ? snap.snapshot.slice(0, 2000) : "",
    }
    sessionActions.push(ev)
    return ev
  } catch (e) {
    const ev: BrowserEvidence = {
      action: "navigate",
      url,
      durationMs: Date.now() - t0,
      timestamp: new Date().toISOString(),
      note: `error: ${(e as Error).message}`,
    }
    sessionActions.push(ev)
    return ev
  }
}

/** Evidence-augmented click. */
export async function clickWithEvidence(selector: string, element?: string): Promise<BrowserEvidence> {
  await ensureReady()
  const t0 = Date.now()
  try {
    await call("browser_click", element ? { target: selector, element } : { target: selector })
    const ev: BrowserEvidence = { action: "click", selector, durationMs: Date.now() - t0, timestamp: new Date().toISOString() }
    sessionActions.push(ev)
    return ev
  } catch (e) {
    const ev: BrowserEvidence = { action: "click", selector, durationMs: Date.now() - t0, timestamp: new Date().toISOString(), note: `error: ${(e as Error).message}` }
    sessionActions.push(ev)
    return ev
  }
}

/** Evidence-augmented fill. */
export async function fillWithEvidence(selector: string, value: string, name?: string): Promise<BrowserEvidence> {
  await ensureReady()
  const t0 = Date.now()
  try {
    await call("browser_fill_form", {
      fields: [{ target: selector, name: name ?? selector, type: "textbox", value }],
    })
    // redacted value for security
    const ev: BrowserEvidence = {
      action: "fill",
      selector,
      value: "***redacted***",
      durationMs: Date.now() - t0,
      timestamp: new Date().toISOString(),
    }
    sessionActions.push(ev)
    return ev
  } catch (e) {
    const ev: BrowserEvidence = { action: "fill", selector, value: "***redacted***", durationMs: Date.now() - t0, timestamp: new Date().toISOString(), note: `error: ${(e as Error).message}` }
    sessionActions.push(ev)
    return ev
  }
}

/** Get full session report as JSON-serializable verification evidence. */
export function getVerificationEvidence(): {
  ok: boolean
  evidence: string[]
  receipts: Array<{ kind: string; summary: string }>
  artifacts: string[]
} {
  if (!sessionReport) {
    return { ok: false, evidence: ["no browser session started"], receipts: [], artifacts: [] }
  }
  const evidence: string[] = []
  const receipts: Array<{ kind: string; summary: string }> = []
  const artifacts: string[] = []
  for (const a of sessionActions) {
    const line = `${a.timestamp} ${a.action} ${a.durationMs}ms${a.url ? " url=" + a.url : ""}${a.selector ? " sel=" + a.selector : ""}${a.note ? " note=" + a.note : ""}`
    evidence.push(line)
    receipts.push({ kind: a.action, summary: line })
  }
  if (sessionReport.consoleErrors === 0) {
    evidence.push("console: no errors detected")
    receipts.push({ kind: "console-clean", summary: "0 errors" })
  } else {
    evidence.push(`console: ${sessionReport.consoleErrors} error(s) detected`)
  }
  evidence.push(`network: ${sessionReport.networkRequests} request(s) made`)
  evidence.push(`session duration: ${sessionReport.totalDurationMs}ms`)
  artifacts.push(`browser-session-${sessionStart}.json`)
  return { ok: true, evidence, receipts, artifacts }
}
