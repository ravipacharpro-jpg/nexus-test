import os from "os"
import { Icon, Style } from "../core/style"
import type { NexusPlugin, PluginContext } from "../core/types"

const PORT = Number(process.env.NEXUS_PORT ?? 4096)

function disabled(ctx: PluginContext, action: string): number {
  ctx.err(`Persistent daemon ${action} is disabled in Assistant mode.`)
  ctx.out(
    `${Style.TEXT_DIM}Run \`nexus serve --port ${PORT}\` in a terminal you control for a foreground local session. ` +
      `NEXUS does not create boot scripts, watchdogs, background restarts, wake-locks, or broad process kills automatically.${Style.TEXT_NORMAL}`,
  )
  return 1
}

async function start(ctx: PluginContext): Promise<number> {
  return disabled(ctx, "start")
}

async function stop(ctx: PluginContext): Promise<number> {
  return disabled(ctx, "stop")
}

async function status(ctx: PluginContext): Promise<number> {
  ctx.out(`${Icon.robot} NEXUS Local Server Status`)
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(3000) })
    ctx.out(`  Foreground server: ${Style.TEXT_SUCCESS_BOLD}HTTP ${response.status}${Style.TEXT_NORMAL}`)
    return 0
  } catch {
    ctx.out(`  Foreground server: ${Style.TEXT_DIM}not running on 127.0.0.1:${PORT}${Style.TEXT_NORMAL}`)
    ctx.out(`${Style.TEXT_DIM}Start it manually with: nexus serve --port ${PORT}${Style.TEXT_NORMAL}`)
    return 1
  }
}

async function autostart(ctx: PluginContext): Promise<number> {
  return disabled(ctx, "autostart")
}

async function remote(ctx: PluginContext): Promise<number | void> {
  ctx.out(`${Icon.info} Keep the service local by default: http://127.0.0.1:${PORT}`)
  ctx.out(`${Style.TEXT_DIM}If remote access is required, configure a private network or tunnel yourself and review its exposure policy. NEXUS does not create network listeners, tunnels, SSH services, or boot tasks.${Style.TEXT_NORMAL}`)
}

const plugin: NexusPlugin = {
  name: "daemon",
  version: "0.1.1",
  description: "Safe foreground-server guidance; persistent autonomous daemons are intentionally disabled",
  tags: ["server", "local", "foreground"],
  commands: [
    { name: "start", describe: "explain the safe foreground-server alternative", usage: "nexus serve --port 4096", run: start },
    { name: "stop", describe: "does not kill background processes automatically", usage: "stop the terminal session you started", run: stop },
    { name: "status", describe: "check whether a local foreground server is responding", usage: "nexus daemon status", run: status },
    { name: "autostart", describe: "disabled; NEXUS does not create boot-time tasks", usage: "not available", run: autostart },
    { name: "remote", describe: "show private-network exposure guidance", usage: "nexus daemon remote", run: remote },
  ],
}

export default plugin

export * as DaemonPlugin from "./daemon"
