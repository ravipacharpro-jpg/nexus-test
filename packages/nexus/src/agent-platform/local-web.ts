import { spawn, stop, type Child } from "../util/process"
import { errorMessage } from "../util/error"

export type LocalWebServerOptions = {
  command: readonly string[]
  cwd: string
  port: number
  host?: string
  startupTimeoutMs?: number
  healthPath?: string
  signal?: AbortSignal
  fetch?: typeof globalThis.fetch
}

export type LocalWebServer = {
  url: string
  command: string[]
  pid?: number
  health: () => Promise<Response>
  stop: () => Promise<void>
}

function assertLocalPort(port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Local web server port is invalid")
}

function assertLocalUrl(url: string) {
  const parsed = new URL(url)
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new Error("Web server health checks are restricted to localhost")
  }
}

async function waitForHealth(
  health: () => Promise<Response>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const deadline = Date.now() + Math.max(100, timeoutMs)
  let lastError: unknown
  while (Date.now() < deadline) {
    signal?.throwIfAborted()
    try {
      const response = await health()
      if (response.status >= 200 && response.status < 500) return response
      lastError = new Error(`Health check returned HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(
    `Local web server did not become healthy within ${timeoutMs}ms${lastError ? `: ${errorMessage(lastError)}` : ""}`,
  )
}

export async function startLocalWebServer(options: LocalWebServerOptions): Promise<LocalWebServer> {
  if (options.command.length === 0) throw new Error("Local web server command is required")
  assertLocalPort(options.port)
  const host = options.host ?? "127.0.0.1"
  const url = `http://${host}:${options.port}${options.healthPath ?? "/"}`
  assertLocalUrl(url)
  const fetchImpl = options.fetch ?? globalThis.fetch
  const health = () => fetchImpl(url, { method: "GET", redirect: "manual", signal: options.signal })
  const child: Child = spawn([...options.command], {
    cwd: options.cwd,
    abort: options.signal,
    timeout: 2_000,
    stdout: "pipe",
    stderr: "pipe",
  })
  try {
    await waitForHealth(health, options.startupTimeoutMs ?? 10_000, options.signal)
  } catch (error) {
    await stop(child)
    await child.exited.catch(() => undefined)
    throw error
  }
  return {
    url,
    command: [...options.command],
    ...(child.pid ? { pid: child.pid } : {}),
    health,
    stop: async () => {
      await stop(child)
      await child.exited.catch(() => undefined)
    },
  }
}

export * as LocalWeb from "./local-web"
