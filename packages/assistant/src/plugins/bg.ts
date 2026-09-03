import path from "path"
import os from "os"
import { Style, Icon, ok, bad, dim } from "../core/style"
import type { NexusPlugin, PluginContext } from "../core/types"

const BG_DIR = path.join(os.homedir(), ".nexus", "bg")

interface BgTask {
  id: string
  command: string
  pid: number
  started: number
  logFile: string
}

function taskDir(): Promise<string> {
  return import("fs/promises").then((fs) => fs.mkdir(BG_DIR, { recursive: true })).then(() => BG_DIR)
}

async function notifyDone(ctx: PluginContext, id: string, code: number): Promise<void> {
  const title = `NEXUS bg ${id} ${code === 0 ? "complete" : "failed"}`
  const cmd = ["termux-notification", "--title", title, "--content", `Log: ~/.nexus/bg/${id}.log`]
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" })
  await proc.exited.catch(() => {})
}

async function run(ctx: PluginContext): Promise<number | void> {
  const command = ctx.args.join(" ")
  if (!command) {
    ctx.err('Usage: nexus bg run "bun install" — survives terminal close (best-effort on Android)')
    return 1
  }

  const dir = await taskDir()
  const id = `bg-${Date.now().toString(36)}`
  const logFile = path.join(dir, `${id}.log`)

  const inner = `( ${command} ) > "${logFile}" 2>&1; code=$?; echo $code > "${dir}/${id}.code"; command -v termux-notification >/dev/null 2>&1 && termux-notification --title "NEXUS ${id} done (exit $code)" --content "nexus bg log ${id}" >/dev/null 2>&1; exit $code`
  const proc = Bun.spawn(["setsid", "bash", "-c", inner], { stdin: "ignore", stdout: "ignore", stderr: "ignore", detached: true })
  proc.unref()

  const meta: BgTask = { id, command, pid: proc.pid, started: Date.now(), logFile }
  await Bun.write(path.join(dir, `${id}.json`), JSON.stringify(meta, null, 2))

  ctx.out(`${Icon.rocket} Started in background: ${Style.TEXT_HIGHLIGHT}${id}${Style.TEXT_NORMAL} (pid ${proc.pid})`)
  ctx.out(`  ${Style.TEXT_DIM}command : ${command}${Style.TEXT_NORMAL}`)
  ctx.out(`  ${Style.TEXT_DIM}log     : nexus bg log ${id}${Style.TEXT_NORMAL}`)
  ctx.out(`  ${Style.TEXT_DIM}list    : nexus bg list${Style.TEXT_NORMAL}`)
}

async function list(ctx: PluginContext): Promise<number | void> {
  const dir = await taskDir()
  const metas: BgTask[] = []
  for (const file of await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: dir }))) {
    try {
      metas.push(await Bun.file(path.join(dir, file)).json())
    } catch {}
  }
  metas.sort((a, b) => b.started - a.started)

  if (metas.length === 0) {
    ctx.out(`${Icon.info} No background tasks. Start one: nexus bg run "npm test"`)
    return 0
  }

  for (const meta of metas.slice(0, 20)) {
    let statusText = Style.TEXT_DIM + "unknown"
    const codeFile = Bun.file(path.join(dir, `${meta.id}.code`))
    if (await codeFile.exists()) {
      const code = parseInt((await codeFile.text()).trim())
      statusText = code === 0 ? ok("done") : bad(`exit ${code}`)
    } else {
      const aliveProc = Bun.spawn(["sh", "-c", `kill -0 ${meta.pid} 2>/dev/null; echo $?`], { stdout: "pipe", stderr: "ignore" })
      await aliveProc.exited
      const out = (await new Response(aliveProc.stdout).text()).trim()
      statusText = out === "0" ? `${Style.TEXT_SUCCESS_BOLD}running${Style.TEXT_NORMAL}` : dim("dead")
    }
    ctx.out(`  ${Style.TEXT_HIGHLIGHT}${meta.id.padEnd(14)}${Style.TEXT_NORMAL} ${statusText}  ${Style.TEXT_DIM}${meta.command.slice(0, 60)}${Style.TEXT_NORMAL}`)
  }
  void notifyDone
}

async function log(ctx: PluginContext): Promise<number | void> {
  const id = ctx.args[0]
  if (!id) {
    ctx.err("Usage: nexus bg log <id>")
    return 1
  }
  const logFile = path.join(BG_DIR, `${id}.log`)
  if (!(await Bun.file(logFile).exists())) {
    ctx.err(`No log for ${id}`)
    return 1
  }
  process.stderr.write(await Bun.file(logFile).text())
}

async function kill(ctx: PluginContext): Promise<number | void> {
  const id = ctx.args[0]
  const dir = BG_DIR
  const metaFile = Bun.file(path.join(dir, `${id}.json`))
  if (!(await metaFile.exists())) {
    ctx.err(`Unknown task: ${id}`)
    return 1
  }
  const meta: BgTask = await metaFile.json()
  const ok = await ctx.confirm({ title: `Kill ${id} (${meta.command})?`, danger: true })
  if (!ok) return 0
  const proc = Bun.spawn(["kill", String(meta.pid)], { stdout: "ignore", stderr: "ignore" })
  await proc.exited
  ctx.out(`${Icon.success} Killed ${id}`)
}

const plugin: NexusPlugin = {
  name: "bg",
  version: "0.1.0",
  description: "Background task queue — long jobs survive terminal close + Termux notification when done",
  tags: ["background", "queue", "notify"],
  commands: [
    { name: "run", describe: 'run a command in background, e.g. nexus bg run "bun install"', usage: 'nexus bg run "<cmd>"', run },
    { name: "list", describe: "list background tasks with live/done/failed status", usage: "nexus bg list", run: list },
    { name: "log", describe: "show output of a background task", usage: "nexus bg log <id>", run: log },
    { name: "kill", describe: "kill a running background task", usage: "nexus bg kill <id>", run: kill },
  ],
}

export default plugin

export * as BgPlugin from "./bg"
