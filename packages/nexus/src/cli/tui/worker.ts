import { Server } from "@/server/server"
import { InstanceRuntime } from "@/project/instance-runtime"
import { Rpc } from "@/util/rpc"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config/config"
import { GlobalBus } from "@/bus/global"
import { ServerAuth } from "@/server/auth"
import { writeHeapSnapshot } from "node:v8"
import { Heap } from "@/cli/heap"
import { AppRuntime } from "@/effect/app-runtime"
import { Effect } from "effect"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { Global } from "@nexus-ai/core/global"
import { appendFileSync, mkdirSync } from "node:fs"
import path from "node:path"

Heap.start()

function recordFatalError(kind: "unhandledRejection" | "uncaughtException", error: unknown) {
  const value = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  // Keep diagnostics useful without writing likely credential material to disk.
  const redacted = value
    .replace(/(api[-_]?key|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
  const line = `${new Date().toISOString()} [${kind}] ${redacted.slice(0, 4000)}\n`
  try {
    mkdirSync(Global.Path.log, { recursive: true })
    appendFileSync(path.join(Global.Path.log, "tui-errors.log"), line, { encoding: "utf8" })
  } catch {
    // Logging must never turn an already-failing worker into a second failure.
  }
}

const onUnhandledRejection = (error: unknown) => recordFatalError("unhandledRejection", error)

const onUncaughtException = (error: unknown) => recordFatalError("uncaughtException", error)

process.on("unhandledRejection", onUnhandledRejection)
process.on("uncaughtException", onUncaughtException)

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

let server: Awaited<ReturnType<typeof Server.listen>> | undefined

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    const headers = { ...input.headers }
    const auth = ServerAuth.header()
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth
    }
    const request = new Request(input.url, {
      method: input.method,
      headers,
      body: input.body,
    })
    const response = await Server.Default().app.fetch(request)
    const body = await response.text()
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  snapshot() {
    const result = writeHeapSnapshot("server.heapsnapshot")
    return result
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    if (server) await server.stop(true)
    server = await Server.listen(input)
    return { url: server.url.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
    await InstanceRuntime.load({ directory: input.directory })
    await upgrade().catch(() => {})
  },
  async reload() {
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const cfg = yield* Config.Service
        yield* cfg.invalidate()
        yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })
      }),
    )
  },
  async shutdown() {
    await InstanceRuntime.disposeAllInstances()
    if (server) await server.stop(true)
    process.off("unhandledRejection", onUnhandledRejection)
    process.off("uncaughtException", onUncaughtException)
  },
}

Rpc.listen(rpc)
