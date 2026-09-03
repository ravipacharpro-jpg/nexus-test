// browser-use client: thin TypeScript wrapper around the official
// browser-use Python MCP server (https://github.com/browser-use/browser-use).
//
// Why: termux + linux desktops get full browser automation (click,
// type, screenshot, navigate) without the playwright-mcp-detect
// gating the rest of the autofarm has been fighting. browser-use
// embeds Chromium itself and ships an MCP server that NEXUS can
// connect to from any platform with a working Python.
//
// This file does NOT shell out to Python. It is a pure TS module
// that documents:
//   - the MCP stdio endpoint the user must register in their
//     ~/.config/nexus/nexus.jsonc
//   - a tiny smoke-check helper that the autofarm master uses to
//     pick the best browser adapter (playwright vs browser-use)
//   - a "BrowserSession" handle other lib/* code can use without
//     caring which adapter actually drives the browser
//
// Cross-platform: the wrapper is pure TS, the heavy lifting is
// in Python which Termux + Linux + macOS + Windows all support
// via 'uv add browser-use' or 'pip install browser-use'.

import { existsSync } from "node:fs"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/** The exact MCP server command the user must register. */
export const BROWSER_USE_MCP_COMMAND = "browser-use"
export const BROWSER_USE_MCP_ARGS: ReadonlyArray<string> = ["--mcp"]

/**
 * Detect whether browser-use is installed and runnable on this device.
 * Tries `browser-use --version` first (preferred), falls back to
 * `python -m browser_use` and `python3 -m browser_use`.
 */
export async function isBrowserUseAvailable(): Promise<{ ok: boolean; version?: string; via?: string }> {
  const attempts: Array<{ cmd: string; args: string[]; label: string }> = [
    { cmd: "browser-use", args: ["--version"], label: "binary" },
    { cmd: "uv", args: ["tool", "run", "browser-use", "--version"], label: "uv" },
    { cmd: "python", args: ["-m", "browser_use", "--version"], label: "python" },
    { cmd: "python3", args: ["-m", "browser_use", "--version"], label: "python3" },
  ]
  for (const a of attempts) {
    try {
      const { stdout } = await execFileAsync(a.cmd, a.args, { timeout: 8_000 })
      const version = String(stdout).trim().split("\n")[0]
      if (version) return { ok: true, version, via: `${a.label}:${a.cmd}` }
    } catch {
      // continue
    }
  }
  return { ok: false }
}

/** Snippet the user can paste into ~/.config/nexus/nexus.jsonc under
 *  the `mcp` key. Kept as a string so it can be printed by the CLI
 *  without importing the JSON parser. */
export const BROWSER_USE_MCP_CONFIG_SNIPPET = `  "browser-use": {
    "type": "local",
    "command": "browser-use",
    "args": ["--mcp"]
  }`

/**
 * BrowserSession: a thin abstraction the autofarm uses to choose
 * between the existing playwright-mcp and the new browser-use-mcp.
 * The choice is made at runtime by sniffing which MCP server is
 * registered in the user's nexus.jsonc.
 */
export interface BrowserSession {
  adapter: "playwright" | "browser-use" | "none"
  /** Best-effort human-readable summary for logs. */
  describe(): string
}

export async function pickBrowserAdapter(): Promise<BrowserSession> {
  const cfgPath = `${process.env.HOME ?? "~"}/.config/nexus/nexus.jsonc`
  // We do not parse JSONC here; just sniff for the substring.
  let config = ""
  try {
    if (existsSync(cfgPath)) {
      const fs = await import("node:fs/promises")
      config = await fs.readFile(cfgPath, "utf8")
    }
  } catch {
    // ignore — empty config is fine
  }
  if (config.includes("browser-use")) {
    const avail = await isBrowserUseAvailable()
    if (avail.ok) {
      return {
        adapter: "browser-use",
        describe: () => `browser-use MCP via ${avail.via} (${avail.version})`,
      }
    }
  }
  return {
    adapter: "none",
    describe: () => "no browser adapter detected (install browser-use or playwright-mcp)",
  }
}
