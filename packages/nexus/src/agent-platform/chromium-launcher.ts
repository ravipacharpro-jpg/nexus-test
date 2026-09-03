import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomInt } from "node:crypto"
import { parseBrowserHandoffTarget } from "./browser-handoff"
import { createBrowserSession, type BrowserSession } from "./browser-session"
import { spawn, stop, type Child } from "../util/process"
import { errorMessage } from "../util/error"

export type ChromiumLauncherOptions = {
  url: string
  executable?: string
  userDataDir?: string
  port?: number
  startupTimeoutMs?: number
  signal?: AbortSignal
}

export type ChromiumSession = {
  url: string
  devtoolsUrl: string
  pid?: number
  stop: () => Promise<void>
}

export type ManagedChromiumBrowserSession = {
  session: BrowserSession
  getChromium: () => ChromiumSession | undefined
  stop: () => Promise<void>
}

function isDevToolsResponse(value: unknown): value is { webSocketDebuggerUrl?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    ("webSocketDebuggerUrl" in value ? typeof value.webSocketDebuggerUrl === "string" : true)
  )
}

async function waitForDevTools(port: number, timeoutMs: number, signal?: AbortSignal) {
  const deadline = Date.now() + Math.max(100, timeoutMs)
  let lastError: unknown
  while (Date.now() < deadline) {
    signal?.throwIfAborted()
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal })
      if (response.ok) {
        const value: unknown = await response.json()
        if (isDevToolsResponse(value)) return value
        lastError = new Error("Chromium returned an invalid DevTools response")
      }
      lastError = new Error(`DevTools returned HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(
    `Chromium DevTools did not become ready within ${timeoutMs}ms${lastError ? `: ${errorMessage(lastError)}` : ""}`,
  )
}

export function createManagedChromiumBrowserSession(
  options: Omit<ChromiumLauncherOptions, "url"> = {},
  launch: typeof launchChromiumSession = launchChromiumSession,
): ManagedChromiumBrowserSession {
  let chromium: ChromiumSession | undefined
  const session = createBrowserSession({
    launch: async (url) => {
      chromium = await launch({ ...options, url })
    },
  })
  return {
    session,
    getChromium: () => chromium,
    stop: async () => {
      await chromium?.stop()
      chromium = undefined
    },
  }
}

export async function launchChromiumSession(options: ChromiumLauncherOptions): Promise<ChromiumSession> {
  const target = parseBrowserHandoffTarget(options.url)
  const port = options.port ?? randomInt(40_000, 49_000)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Chromium DevTools port is invalid")
  const userDataDir = options.userDataDir ?? (await mkdtemp(join(tmpdir(), "nexus-browser-profile-")))
  const child: Child = spawn(
    [
      options.executable ?? "chromium",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      target.launchUrl,
    ],
    { abort: options.signal, timeout: 2_000, stdout: "ignore", stderr: "pipe" },
  )
  try {
    const devtools = await waitForDevTools(port, options.startupTimeoutMs ?? 10_000, options.signal)
    if (!devtools.webSocketDebuggerUrl) throw new Error("Chromium did not expose a DevTools WebSocket")
    return {
      url: target.launchUrl,
      devtoolsUrl: devtools.webSocketDebuggerUrl,
      ...(child.pid ? { pid: child.pid } : {}),
      stop: async () => {
        await stop(child)
        await child.exited.catch(() => undefined)
      },
    }
  } catch (error) {
    await stop(child)
    await child.exited.catch(() => undefined)
    throw error
  }
}

export * as ChromiumLauncher from "./chromium-launcher"
