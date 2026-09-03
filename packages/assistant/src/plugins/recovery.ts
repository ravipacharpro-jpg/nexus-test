import path from "path"
import os from "os"
import { Style, Icon } from "../core/style"
import type { NexusPlugin, PluginContext } from "../core/types"

const SNAPSHOT_DIR = path.join(os.homedir(), ".nexus", "snapshots")
const EXCLUDES = ["node_modules", ".git", "dist", "build", ".next", "coverage", ".cache", "vendor", ".env", ".env.*", "*.key", "*.pem", "*.crt", "*.pfx", "*.p12"]

interface SnapshotMeta {
  id: string
  name: string
  project: string
  branch?: string
  createdAt: number
  files: number
  bytes: number
}

async function snapshotDir(): Promise<string> {
  const dir = SNAPSHOT_DIR
  await import("fs/promises").then((fs) => fs.mkdir(dir, { recursive: true }))
  return dir
}

async function gitBranch(project: string): Promise<string | undefined> {
  const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: project, stdout: "pipe", stderr: "ignore" })
  const [exit] = await Promise.all([proc.exited])
  if (exit !== 0) return undefined
  return (await new Response(proc.stdout).text()).trim() || undefined
}

async function save(ctx: PluginContext): Promise<number | void> {
  const request = recoverySaveRequest(ctx.args, ctx.flags)
  const project = path.resolve(ctx.cwd, request.project ?? ".")
  const autoName = `snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}`
  const name = request.name ?? autoName
  const id = `snap-${Date.now()}`

  const fs = await import("fs/promises")
  const stat = await fs.stat(project).catch(() => undefined)
  if (!stat?.isDirectory()) {
    ctx.err(`Project directory not found: ${project}`)
    return 1
  }

  ctx.out(`${Icon.info} Creating snapshot of ${project}`)
  const dir = await snapshotDir()
  const dest = path.join(dir, id)

  const excludeArgs = EXCLUDES.flatMap((e) => [`--exclude`, e])
  const proc = Bun.spawn(["tar", "-czf", `${dest}.tar.gz`, ...excludeArgs, "-C", project, "."], {
    stdout: "ignore",
    stderr: "pipe",
  })
  const exit = await proc.exited
  if (exit !== 0) {
    ctx.err(`tar failed: ${await new Response(proc.stderr).text()}`)
    return 1
  }

  const file = Bun.file(`${dest}.tar.gz`)
  const bytes = file.size
  const meta: SnapshotMeta = { id, name, project, branch: await gitBranch(project), createdAt: Date.now(), files: 0, bytes }
  await Bun.write(path.join(dir, `${id}.json`), JSON.stringify(meta, null, 2))

  ctx.out(`${Icon.success} Snapshot saved: ${Style.TEXT_SUCCESS_BOLD}${name}${Style.TEXT_NORMAL}`)
  ctx.out(`  ${Style.TEXT_DIM}id: ${id}  size: ${(bytes / 1024 / 1024).toFixed(1)} MB${Style.TEXT_NORMAL}`)
}

export function recoverySaveRequest(args: string[], flags: Record<string, unknown>): { project?: string; name?: string } {
  const input = args[0] === "save" ? args.slice(1) : args
  const project = typeof flags.path === "string" && flags.path ? flags.path : undefined
  const name = typeof flags.name === "string" && flags.name ? flags.name : input[0]
  return { project, name }
}

async function listSnapshots(ctx: PluginContext): Promise<number | void> {
  const dir = await snapshotDir()
  const metas: SnapshotMeta[] = []
  for (const glob of await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: dir }))) {
    metas.push(await Bun.file(path.join(dir, glob)).json())
  }
  metas.sort((a, b) => b.createdAt - a.createdAt)

  if (metas.length === 0) {
    ctx.out(`${Icon.warn} No snapshots yet — create one with: nexus recovery save "before-refactor"`)
    return 0
  }

  ctx.out(`${Icon.info} Snapshots (${metas.length}):`)
  for (const meta of metas) {
    const date = new Date(meta.createdAt).toLocaleString()
    ctx.out(`  ${Style.TEXT_HIGHLIGHT}${meta.id}${Style.TEXT_NORMAL}  ${meta.name}  ${Style.TEXT_DIM}${date}  ${(meta.bytes / 1024 / 1024).toFixed(1)} MB${Style.TEXT_NORMAL}`)
  }
}

async function restore(ctx: PluginContext): Promise<number | void> {
  const dir = await snapshotDir()
  const target = ctx.args[0]
  if (!target || target === "--latest") {
    return restoreLatest(ctx)
  }

  const id = target.startsWith("snap-") ? target : (await findByName(target)) ?? target
  const archive = Bun.file(path.join(dir, `${id}.tar.gz`))
  if (!(await archive.exists())) {
    ctx.err(`Snapshot not found: ${id}`)
    return 1
  }
  const meta = (await Bun.file(path.join(dir, `${id}.json`)).json()) as SnapshotMeta
  return unpack(ctx, id, meta.project)
}

async function restoreLatest(ctx: PluginContext): Promise<number | void> {
  const dir = await snapshotDir()
  const metas: SnapshotMeta[] = []
  for (const glob of await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: dir }))) {
    metas.push(await Bun.file(path.join(dir, glob)).json())
  }
  metas.sort((a, b) => b.createdAt - a.createdAt)
  const latest = metas[0]
  if (!latest) {
    ctx.err("No snapshots available")
    return 1
  }
  return unpack(ctx, latest.id, latest.project)
}

async function findByName(name: string): Promise<string | undefined> {
  const dir = await snapshotDir()
  for (const glob of await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: dir }))) {
    const meta: SnapshotMeta = await Bun.file(path.join(dir, glob)).json()
    if (meta.name === name) return meta.id
  }
  return undefined
}

async function unpack(ctx: PluginContext, id: string, project: string): Promise<number | void> {
  const ok = await ctx.confirm({
    title: `Restore snapshot ${id}?`,
    detail: `Current files in ${project} will be replaced with the snapshot state`,
    danger: true,
  })
  if (!ok) {
    ctx.out("Restore cancelled")
    return 0
  }

  const fs = await import("fs/promises")
  const entries = await fs.readdir(project).catch(() => [])
  for (const entry of entries) {
    if (entry === ".git") continue
    await fs.rm(path.join(project, entry), { recursive: true, force: true })
  }

  const dir = await snapshotDir()
  const proc = Bun.spawn(["tar", "-xzf", path.join(dir, `${id}.tar.gz`), "-C", project], { stdout: "ignore", stderr: "pipe" })
  const exit = await proc.exited
  if (exit !== 0) {
    ctx.err(`Restore failed: ${await new Response(proc.stderr).text()}`)
    return 1
  }
  ctx.out(`${Icon.success} Project restored to snapshot ${id}`)
}

async function infoSnapshot(ctx: PluginContext): Promise<number | void> {
  const id = ctx.args[0]
  const dir = await snapshotDir()
  const metaPath = path.join(dir, `${id?.startsWith("snap-") ? id : await findByName(id ?? "") ?? id}.json`)
  const file = Bun.file(metaPath)
  if (!(await file.exists())) {
    ctx.err(`Snapshot not found: ${id}`)
    return 1
  }
  const meta: SnapshotMeta = await file.json()
  ctx.out(`${Icon.info} ${meta.id}`)
  ctx.out(`  name    : ${meta.name}`)
  ctx.out(`  project : ${meta.project}`)
  ctx.out(`  branch  : ${meta.branch ?? "-"}`)
  ctx.out(`  created : ${new Date(meta.createdAt).toLocaleString()}`)
  ctx.out(`  size    : ${(meta.bytes / 1024 / 1024).toFixed(2)} MB`)
}

async function cleanSnapshots(ctx: PluginContext): Promise<number | void> {
  const dir = await snapshotDir()
  const metas: SnapshotMeta[] = []
  for (const glob of await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: dir }))) {
    metas.push(await Bun.file(path.join(dir, glob)).json())
  }
  metas.sort((a, b) => b.createdAt - a.createdAt)

  let remove = new Set<string>()
  if (typeof ctx.flags.keep === "number") {
    remove = new Set(metas.slice(ctx.flags.keep).map((m) => m.id))
  } else if (typeof ctx.flags.olderThan === "string") {
    const days = parseInt(ctx.flags.olderThan) || 30
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    remove = new Set(metas.filter((m) => m.createdAt < cutoff).map((m) => m.id))
  } else {
    ctx.err("Usage: nexus recovery clean --keep 10  |  --older-than 30d")
    return 1
  }

  if (remove.size === 0) {
    ctx.out(`${Icon.success} Nothing to clean`)
    return 0
  }
  const fs = await import("fs/promises")
  for (const id of remove) {
    await fs.rm(path.join(dir, `${id}.tar.gz`), { force: true })
    await fs.rm(path.join(dir, `${id}.json`), { force: true })
  }
  ctx.out(`${Icon.success} Removed ${remove.size} snapshot(s)`)
}

async function autoSnapshots(ctx: PluginContext): Promise<number | void> {
  const state = ctx.args[0] === "on" ? true : ctx.args[0] === "off" ? false : undefined
  if (state === undefined) {
    ctx.err("Usage: nexus recovery auto on|off")
    return 1
  }
  const dir = await snapshotDir()
  const cfgPath = path.join(dir, "config.json")
  const cfg = (await Bun.file(cfgPath).exists()) ? await Bun.file(cfgPath).json() : {}
  cfg.autoBeforeDestructive = state
  cfg.triggers = ["before refactor", "before deps:clean", "before db:migrate", "before git reset --hard"]
  await Bun.write(cfgPath, JSON.stringify(cfg, null, 2))
  ctx.out(`${Icon.success} Auto-snapshots ${state ? "ON" : "OFF"} ${Style.TEXT_DIM}(destructive operations se pehle)${Style.TEXT_NORMAL}`)
}

const plugin: NexusPlugin = {
  name: "recovery",
  version: "0.1.0",
  description: "Time Machine: instant project snapshots and one-command restore",
  tags: ["backup", "snapshot", "restore"],
  commands: [
    { name: "save", describe: 'create a project snapshot, e.g. nexus recovery save "before-refactor"', usage: 'nexus recovery save [name] [--cwd project]', run: save },
    { name: "list", describe: "list all snapshots", usage: "nexus recovery list", run: listSnapshots },
    { name: "restore", describe: "restore a snapshot by id/name, or --latest", usage: "nexus recovery restore <id|name|--latest>", run: restore },
    { name: "info", describe: "show details of one snapshot", usage: "nexus recovery info <id|name>", run: infoSnapshot },
    { name: "clean", describe: "delete old snapshots (--keep 10 | --older-than 30d)", usage: "nexus recovery clean --keep 10", run: cleanSnapshots },
    { name: "auto", describe: "enable/disable auto-snapshot before destructive ops", usage: "nexus recovery auto on|off", run: autoSnapshots },
  ],
}

export default plugin

export * as RecoveryPlugin from "./recovery"
