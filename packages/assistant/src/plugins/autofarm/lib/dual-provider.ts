// dual-provider: keep BOTH the built-in OpenCode free default API and
// the OmniRoute free gateway active at the same time. The router tries
// OpenCode first; if it 401s, 429s or 5xxs, OmniRoute takes over without
// any user action.
//
// Config is written to ~/.config/nexus/opencode.jsonc so the running
// NEXUS process picks it up on next request.

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { log } from "./logger.ts"

const CONFIG_PATH = path.join(os.homedir(), ".config", "nexus", "opencode.jsonc")
const OMNI_PORT = 20128
const OMNI_URL = `http://localhost:${OMNI_PORT}/v1`

export interface DualProviderConfig {
  /** Built-in free default (always-on, no key required). */
  opencode: { enabled: boolean; baseUrl: string; apiKey?: string }
  /** Optional OmniRoute local gateway (90+ free providers). */
  omniroute: { enabled: boolean; baseUrl: string; auth?: string }
  /** Auto-start OmniRoute server if not running. */
  omnirouteAutostart: boolean
  /** Prefer order when both are healthy. */
  prefer: "opencode" | "omniroute" | "auto"
  /** Auto-rotate on failure. */
  failover: boolean
}

export const DEFAULT_DUAL: DualProviderConfig = {
  opencode: { enabled: true, baseUrl: "https://opencode.ai/api/v1" },
  omniroute: { enabled: true, baseUrl: OMNI_URL },
  omnirouteAutostart: true,
  prefer: "auto",
  failover: true,
}

function readConfig(): DualProviderConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULT_DUAL }
    const raw = fs.readFileSync(CONFIG_PATH, "utf8")
    // Strip comments
    const stripped = raw
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("/*"))
      .join("\n")
      // JSONC trailing comma fix
      .replace(/,(\s*[}\]])/g, "$1")
    const parsed = JSON.parse(stripped) as Partial<DualProviderConfig>
    return {
      ...DEFAULT_DUAL,
      ...parsed,
      opencode: { ...DEFAULT_DUAL.opencode, ...(parsed.opencode ?? {}) },
      omniroute: { ...DEFAULT_DUAL.omniroute, ...(parsed.omniroute ?? {}) },
    }
  } catch (e) {
    log.warn("dual", `config read failed, using defaults: ${(e as Error).message}`)
    return { ...DEFAULT_DUAL }
  }
}

function writeConfig(c: DualProviderConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  const text = JSON.stringify(c, null, 2)
  fs.writeFileSync(CONFIG_PATH, text + "\n")
  log.info("dual", `wrote ${CONFIG_PATH}`)
}

/** Check if a URL responds OK. */
async function ping(url: string, headers: Record<string, string> = {}): Promise<{ ok: boolean; latencyMs: number; status: number }> {
  const t0 = Date.now()
  try {
    const ctl = new AbortController()
    const tid = setTimeout(() => ctl.abort(), 5_000)
    const res = await fetch(url, { method: "GET", headers, signal: ctl.signal })
    clearTimeout(tid)
    return { ok: res.ok || res.status === 401, latencyMs: Date.now() - t0, status: res.status }
  } catch {
    return { ok: false, latencyMs: 0, status: 0 }
  }
}

/** Probe both providers; return the one to use right now. */
export async function pickProvider(): Promise<{ use: "opencode" | "omniroute"; reason: string }> {
  const cfg = readConfig()
  if (!cfg.opencode.enabled && !cfg.omniroute.enabled) {
    return { use: "opencode", reason: "no provider enabled; falling back to default" }
  }
  const probes = await Promise.all([
    cfg.opencode.enabled
      ? ping(cfg.opencode.baseUrl + "/models", cfg.opencode.apiKey ? { Authorization: `Bearer ${cfg.opencode.apiKey}` } : {})
      : Promise.resolve({ ok: false, latencyMs: 0, status: 0 }),
    cfg.omniroute.enabled ? ping(cfg.omniroute.baseUrl + "/models") : Promise.resolve({ ok: false, latencyMs: 0, status: 0 }),
  ])
  const [oc, omni] = probes
  log.info("dual", `opencode: ok=${oc.ok} ${oc.latencyMs}ms (${oc.status}); omniroute: ok=${omni.ok} ${omni.latencyMs}ms (${omni.status})`)

  if (cfg.prefer === "opencode") {
    if (oc.ok) return { use: "opencode", reason: "preferred + healthy" }
    if (omni.ok) return { use: "omniroute", reason: "opencode unreachable, failover" }
    return { use: "opencode", reason: "both down, defaulting to opencode" }
  }
  if (cfg.prefer === "omniroute") {
    if (omni.ok) return { use: "omniroute", reason: "preferred + healthy" }
    if (oc.ok) return { use: "opencode", reason: "omniroute unreachable, failover" }
    return { use: "omniroute", reason: "both down, defaulting to omniroute" }
  }
  // auto
  if (oc.ok && omni.ok) {
    // Pick the lower latency
    if (oc.latencyMs <= omni.latencyMs) return { use: "opencode", reason: `lower latency (${oc.latencyMs}ms vs ${omni.latencyMs}ms)` }
    return { use: "omniroute", reason: `lower latency (${omni.latencyMs}ms vs ${oc.latencyMs}ms)` }
  }
  if (oc.ok) return { use: "opencode", reason: "omniroute unreachable" }
  if (omni.ok) return { use: "omniroute", reason: "opencode unreachable" }
  return { use: "opencode", reason: "both down; try anyway" }
}

/** Ensure OmniRoute is running. If not, start it. */
export async function ensureOmniRoute(): Promise<{ running: boolean; pid?: number; port: number }> {
  const cfg = readConfig()
  const probe = await ping(OMNI_URL + "/models")
  if (probe.ok) return { running: true, port: OMNI_PORT }
  if (!cfg.omnirouteAutostart) return { running: false, port: OMNI_PORT }
  // Try to start it via the existing installer script
  const startScript = path.join(os.homedir(), "nexus", ".nexus", "scripts", "start-omniroute.sh")
  if (!fs.existsSync(startScript)) {
    log.warn("dual", `OmniRoute start script not found at ${startScript}; install it via 'nexus autofarm omniroute install'`)
    return { running: false, port: OMNI_PORT }
  }
  try {
    log.info("dual", "starting OmniRoute in background…")
    const child = (await import("node:child_process")).spawn("bash", [startScript], { detached: true, stdio: "ignore" })
    child.unref()
    // Give it a few seconds to come up
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 1_000))
      const p = await ping(OMNI_URL + "/models")
      if (p.ok) return { running: true, pid: child.pid, port: OMNI_PORT }
    }
    return { running: false, port: OMNI_PORT }
  } catch (e) {
    log.warn("dual", `failed to start OmniRoute: ${(e as Error).message}`)
    return { running: false, port: OMNI_PORT }
  }
}

/** Enable dual-provider mode in the config (idempotent). */
export function enableDualProvider(): DualProviderConfig {
  const cfg = readConfig()
  cfg.opencode.enabled = true
  cfg.omniroute.enabled = true
  cfg.omnirouteAutostart = true
  cfg.failover = true
  writeConfig(cfg)
  return cfg
}

export function getDualConfigPath(): string {
  return CONFIG_PATH
}
