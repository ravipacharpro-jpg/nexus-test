// reticle-lite: NEXUS integration with the Reticle verification MCP server.
// Reticle (https://reticle.sh) is an open-source proofreader for AI-written code.
// It runs an SDK inside the user's app and lets the agent verify what actually
// happened — network calls, store state, console, signals — and hand back
// pass/fail/couldn't-tell with file:line.
//
// Why integrate:
//   - NEXUS's demand-supply engine finds new providers; Reticle verifies they
//     actually work before adding to the catalog
//   - NEXUS's autofarm creates Gmail accounts; Reticle verifies the flow worked
//   - NEXUS's agent loop can call Reticle's MCP server to assert any claim
//     against the running app
//
// How to use:
//   1. User runs: npx @reticlehq/server init  (auto-registers MCP server)
//   2. User installs reticle SDK in their app: npm i -D @reticlehq/react
//   3. NEXUS can now call: await reticle.assert({...})
//
// This module is a thin NEXUS-side wrapper. The real value lives in the
// Reticle daemon running on localhost.

import { spawn, type ChildProcess } from "node:child_process"
import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import { log } from "./logger.ts"

const RETICLE_BIN = process.env.RETICLE_BIN ?? "npx"
const RETICLE_PKG = "@reticlehq/server"
const RETICLE_DAEMON_PORT = Number(process.env.RETICLE_DAEMON_PORT ?? 8765)
const RETICLE_STATUS_FILE = path.join(os.homedir(), ".reticle", "status.json")

export interface ReticleStatus {
  installed: boolean
  daemonRunning: boolean
  connected: boolean
  sessionId?: string
  appUrl?: string
  lastCheck: string
  message: string
}

/** Check whether `npx @reticlehq/server` is reachable on this machine. */
export async function isReticleInstalled(): Promise<boolean> {
  try {
    const { spawnSync } = await import("node:child_process")
    const r = spawnSync("npx", ["--no-install", RETICLE_PKG, "--version"], {
      encoding: "utf8",
      timeout: 8_000,
    })
    return r.status === 0
  } catch {
    return false
  }
}

/** Read the latest Reticle status (written by the daemon to ~/.reticle/status.json). */
export function readReticleStatus(): ReticleStatus {
  try {
    if (!fs.existsSync(RETICLE_STATUS_FILE)) {
      return { installed: false, daemonRunning: false, connected: false, lastCheck: new Date().toISOString(), message: "no status file" }
    }
    return JSON.parse(fs.readFileSync(RETICLE_STATUS_FILE, "utf8")) as ReticleStatus
  } catch (e) {
    return { installed: false, daemonRunning: false, connected: false, lastCheck: new Date().toISOString(), message: `read failed: ${(e as Error).message}` }
  }
}

/** Run `npx @reticlehq/server status` and capture the JSON. */
export async function runReticleStatus(): Promise<{ ok: boolean; stdout: string; stderr: string; ms: number }> {
  const t0 = Date.now()
  return new Promise((resolve) => {
    const proc = spawn("npx", ["--no-install", RETICLE_PKG, "status"], { encoding: "utf8" })
    let stdout = ""
    let stderr = ""
    proc.stdout?.on("data", (d) => (stdout += d.toString()))
    proc.stderr?.on("data", (d) => (stderr += d.toString()))
    const timer = setTimeout(() => { try { proc.kill() } catch {} }, 15_000)
    proc.on("close", (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, stdout, stderr, ms: Date.now() - t0 })
    })
    proc.on("error", (e) => {
      clearTimeout(timer)
      resolve({ ok: false, stdout, stderr: stderr + "\n" + e.message, ms: Date.now() - t0 })
    })
  })
}

/**
 * The main "verify" call. When invoked, it asks the Reticle MCP server
 * to assert a claim against the currently-connected app session.
 *
 * In a full integration this would call the MCP tool `reticle_assert`
 * (or `browser_assert` in older naming). For NEXUS-autofarm we expose
 * a typed function that returns a verdict.
 */
export interface AssertPredicate {
  kind: "net" | "element" | "console" | "signal" | "route" | "store"
  // for kind: "net"
  method?: string
  urlContains?: string
  status?: number
  count?: number
  // for kind: "element"
  query?: { role?: string; name?: string; selector?: string; testId?: string }
  state?: "visible" | "hidden" | "enabled" | "disabled" | "checked" | "unchecked"
  // for kind: "console"
  level?: "error" | "warning" | "info" | "debug"
  absent?: boolean
  // for kind: "signal"
  name?: string
  fired?: boolean
  // for kind: "store"
  path?: string
  equals?: unknown
}

export interface AssertOptions {
  allOf: AssertPredicate[]
  timeoutMs?: number
  /** Optional human description of the claim being verified. */
  claim?: string
}

export interface AssertVerdict {
  pass: boolean
  /** "pass" | "fail" | "couldn't tell" — Reticle's tri-state. */
  verdict: "pass" | "fail" | "couldn't tell"
  /** First failing predicate, if any. */
  failureReason?: string
  /** Source location if Reticle can map the failure back to code. */
  source?: { file: string; line: number }
  /** Time the assertion took. */
  ms: number
  /** Coverage hint: "full" | "partial:<reason>" */
  coverage: "full" | string
  /** Raw Reticle response, for debugging. */
  raw?: unknown
}

const RETICLE_MCP_PORT = Number(process.env.RETICLE_MCP_PORT ?? 8766)

/**
 * Call Reticle's MCP server. Since we don't want to spawn the full
 * MCP protocol here (it requires a separate install), we go through
 * the npx CLI which is what Reticle ships. The CLI outputs a JSON
 * verdict that we parse.
 *
 * For real-time, multi-app integration, set RETICLE_MCP_URL to the
 * running MCP server and we'll use JSON-RPC over HTTP instead.
 */
export async function assert(opts: AssertOptions): Promise<AssertVerdict> {
  const t0 = Date.now()
  const claim = opts.claim ?? `${opts.allOf.length} condition(s) must hold`
  log.info("reticle", `assert: ${claim}`)

  // If RETICLE_MCP_URL is set, use JSON-RPC over HTTP.
  if (process.env.RETICLE_MCP_URL) {
    try {
      const url = `${process.env.RETICLE_MCP_URL.replace(/\/$/, "")}/v1/tools/call`
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "reticle_assert", args: { claim, allOf: opts.allOf, timeoutMs: opts.timeoutMs ?? 10_000 } }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      })
      if (!r.ok) throw new Error(`MCP HTTP ${r.status}`)
      const data = await r.json() as Partial<AssertVerdict>
      return {
        pass: data.pass ?? false,
        verdict: data.verdict ?? (data.pass ? "pass" : "couldn't tell"),
        failureReason: data.failureReason,
        source: data.source,
        ms: Date.now() - t0,
        coverage: data.coverage ?? "partial:mcp-no-coverage-info",
        raw: data,
      }
    } catch (e) {
      log.warn("reticle", `MCP call failed: ${(e as Error).message}; falling back to CLI`)
    }
  }

  // Fallback: spawn the CLI with a JSON payload via stdin.
  // The Reticle CLI's `assert` subcommand is what we use here (synthesised
  // since the real one lives in the daemon).
  try {
    const { spawnSync } = await import("node:child_process")
    const payload = JSON.stringify({ claim, allOf: opts.allOf })
    const r = spawnSync("npx", ["--no-install", RETICLE_PKG, "assert", "--json"], {
      input: payload,
      encoding: "utf8",
      timeout: opts.timeoutMs ?? 10_000,
    })
    if (r.status !== 0) {
      // Reticle CLI isn't on this machine — emit a "couldn't tell" rather than
      // crashing the autofarm pipeline.
      return {
        pass: false,
        verdict: "couldn't tell",
        failureReason: `reticle CLI unavailable: ${(r.stderr || r.error?.message || "?").slice(0, 200)}`,
        ms: Date.now() - t0,
        coverage: "partial:no-reticle-daemon",
      }
    }
    const data = JSON.parse(r.stdout) as Partial<AssertVerdict>
    return {
      pass: data.pass ?? false,
      verdict: data.verdict ?? (data.pass ? "pass" : "couldn't tell"),
      failureReason: data.failureReason,
      source: data.source,
      ms: Date.now() - t0,
      coverage: data.coverage ?? "full",
      raw: data,
    }
  } catch (e) {
    return {
      pass: false,
      verdict: "couldn't tell",
      failureReason: (e as Error).message,
      ms: Date.now() - t0,
      coverage: "partial:error",
    }
  }
}

/** Pre-built predicates for common autofarm checks. */
export const Reticle = {
  netSucceeded: (urlContains: string, method: "GET" | "POST" = "POST"): AssertPredicate => ({
    kind: "net", method, urlContains, status: 200,
  }),
  elementVisible: (role: string, name: string): AssertPredicate => ({
    kind: "element", query: { role, name }, state: "visible",
  }),
  noConsoleErrors: (): AssertPredicate => ({ kind: "console", level: "error", absent: true }),
  signalFired: (name: string): AssertPredicate => ({ kind: "signal", name, fired: true }),
  storeEquals: (path: string, equals: unknown): AssertPredicate => ({ kind: "store", path, equals }),
}

/** Quick install helper. */
export function installCommand(): string {
  return [
    "# Step 1: register the Reticle MCP server for your agent",
    "claude mcp add reticle -s user -- npx @reticlehq/server mcp",
    "",
    "# Step 2: install the SDK in your app (pick your framework)",
    "npm i -D @reticlehq/react @reticlehq/vite-plugin    # Vite + React",
    "# or",
    "npm i -D @reticlehq/react @reticlehq/next           # Next.js",
    "",
    "# Step 3: start the daemon and verify",
    "npx @reticlehq/server status",
    "",
    "# Step 4: from NEXUS, use reticle.assert(...) to verify any claim",
  ].join("\n")
}
