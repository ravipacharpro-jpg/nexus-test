// Python bridge for the autofarm plugin.
// Spawns the existing nexus-keyfarm Python scripts (run.py,
// gmail_creator.py, live_tester.py, demand_supply.py, browser_automation.py)
// so the NEXUS autofarm plugin can drive them and read their state.

import { spawn, type ChildProcess } from "node:child_process"
import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import { log } from "./logger.ts"

const PYTHON = process.env.NEXUS_PYTHON ?? "/data/data/com.termux/files/usr/bin/python3"
const KEYFARM_DIR = process.env.NEXUS_KEYFARM_DIR ?? path.join(os.homedir(), "nexus-keyfarm")
const KEYFARM_DIR_DOT = path.join(os.homedir(), ".nexus-keyfarm")
const TMP_DIR = path.join(os.homedir(), ".nexus-keyfarm", ".tmp")

function ensureTmp(): void {
  try {
    fs.mkdirSync(TMP_DIR, { recursive: true })
  } catch {}
}

function resolveScript(name: string): string {
  // Try both ~/nexus-keyfarm (real) and ~/.nexus-keyfarm (used by .tmp)
  const candidates = [
    path.join(KEYFARM_DIR, name),
    path.join(KEYFARM_DIR_DOT, name),
  ]
  for (const p of candidates) if (fs.existsSync(p)) return p
  return candidates[0]
}

export interface PythonResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  ms: number
}

function runPython(args: string[], opts: { timeoutMs?: number } = {}): Promise<PythonResult> {
  ensureTmp()
  return new Promise((resolve) => {
    const t0 = Date.now()
    // Resolve cwd to whichever keyfarm dir exists
    const cwd = fs.existsSync(KEYFARM_DIR) ? KEYFARM_DIR : (fs.existsSync(KEYFARM_DIR_DOT) ? KEYFARM_DIR_DOT : KEYFARM_DIR)
    const proc: ChildProcess = spawn(PYTHON, args, {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    })
    let stdout = ""
    let stderr = ""
    proc.stdout?.on("data", (d) => (stdout += d.toString()))
    proc.stderr?.on("data", (d) => (stderr += d.toString()))

    const timeout = setTimeout(() => {
      try {
        proc.kill()
      } catch {}
    }, opts.timeoutMs ?? 60_000)

    proc.on("close", (code) => {
      clearTimeout(timeout)
      resolve({ ok: code === 0, code, stdout, stderr, ms: Date.now() - t0 })
    })
    proc.on("error", (e) => {
      clearTimeout(timeout)
      resolve({ ok: false, code: null, stdout, stderr: stderr + "\n" + e.message, ms: Date.now() - t0 })
    })
  })
}

export const pythonBridge = {
  /** Run the Python orchestrator with --status (read-only). */
  async status(): Promise<PythonResult> {
    return runPython([resolveScript("run.py"), "--status"])
  },

  /** Run one auto-farm cycle (gated by demand-supply logic). */
  async autoFarm(): Promise<PythonResult> {
    log.info("py-bridge", "Invoking run.py --auto")
    return runPython([resolveScript("run.py"), "--auto"], { timeoutMs: 10 * 60_000 })
  },

  /** Force farm (create 2 accounts + farm 3 providers). */
  async forceFarm(): Promise<PythonResult> {
    log.info("py-bridge", "Invoking run.py --farm")
    return runPython([resolveScript("run.py"), "--farm"], { timeoutMs: 15 * 60_000 })
  },

  /** Demand-supply dry run. */
  async dryRun(): Promise<PythonResult> {
    return runPython([resolveScript("run.py"), "--dry-run"])
  },

  /** Create N Gmail accounts via the Python gmail_creator. */
  async createGmail(n: number): Promise<PythonResult> {
    log.info("py-bridge", `Invoking gmail_creator.py --create ${n}`)
    return runPython([resolveScript("gmail_creator.py"), "--create", String(n)], {
      timeoutMs: 10 * 60_000,
    })
  },

  /** Show Gmail status via Python. */
  async gmailStatus(): Promise<PythonResult> {
    return runPython([resolveScript("gmail_creator.py"), "--status"])
  },

  /** Real HTTP validation of every key in the vault. */
  async liveTest(): Promise<PythonResult> {
    log.info("py-bridge", "Invoking live_tester.py")
    return runPython([resolveScript("live_tester.py")], { timeoutMs: 5 * 60_000 })
  },

  /** Demand-supply snapshot as JSON. */
  async demandSnapshot(): Promise<PythonResult> {
    return runPython([resolveScript("demand_supply.py"), "--check"])
  },

  /** Paths the bridge exposes so the rest of the plugin can read them. */
  paths(): { keyfarmDir: string; tmpDir: string; python: string; demandSupply: string; gmailCreds: string; browserCommands: string; farmLog: string } {
    return {
      keyfarmDir: fs.existsSync(KEYFARM_DIR) ? KEYFARM_DIR : KEYFARM_DIR_DOT,
      tmpDir: TMP_DIR,
      python: PYTHON,
      demandSupply: path.join(TMP_DIR, "demand-supply.json"),
      gmailCreds: path.join(TMP_DIR, "credentials.json"),
      browserCommands: path.join(TMP_DIR, "browser-commands.json"),
      farmLog: path.join(TMP_DIR, "farm-log.json"),
    }
  },

  /** Read a JSON file from the keyfarm tmp dir if present. */
  readJson<T>(name: string): T | null {
    try {
      const p = path.join(TMP_DIR, name)
      if (!fs.existsSync(p)) return null
      return JSON.parse(fs.readFileSync(p, "utf8")) as T
    } catch (e) {
      log.warn("py-bridge", `readJson(${name}) failed: ${(e as Error).message}`)
      return null
    }
  },
}

export function pythonInstalled(): boolean {
  try {
    if (!fs.existsSync(PYTHON)) return false
    return fs.existsSync(KEYFARM_DIR) || fs.existsSync(KEYFARM_DIR_DOT)
  } catch {
    return false
  }
}