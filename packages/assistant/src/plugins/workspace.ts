import path from "path"
import { Style, Icon } from "../core/style"
import type { NexusPlugin, PluginContext } from "../core/types"

interface WorkspaceProject {
  name: string
  path: string
  type: string
}

const WORKSPACE_FILE = "nexus-workspace.json"

function detectType(entries: string[]): string {
  if (entries.includes("package.json")) return "node"
  if (entries.includes("Cargo.toml")) return "rust"
  if (entries.includes("pyproject.toml") || entries.includes("requirements.txt")) return "python"
  if (entries.includes("composer.json")) return "php"
  if (entries.includes("go.mod")) return "go"
  return "unknown"
}

async function loadWorkspace(ctx: PluginContext): Promise<WorkspaceProject[]> {
  const file = Bun.file(path.join(ctx.cwd, WORKSPACE_FILE))
  if (!(await file.exists())) return []
  const data = await file.json()
  return (data.projects as WorkspaceProject[]) ?? []
}

async function init(ctx: PluginContext): Promise<number | void> {
  const fs = await import("fs/promises")
  const projects: WorkspaceProject[] = []

  for (const entry of await fs.readdir(ctx.cwd, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue
    const dir = path.join(ctx.cwd, entry.name)
    const type = detectType(await fs.readdir(dir))
    if (type === "unknown") continue
    projects.push({ name: entry.name, path: path.relative(ctx.cwd, dir), type })
    ctx.out(`  [${entry.name}] ${type} ${Style.TEXT_DIM}${path.relative(ctx.cwd, dir)}${Style.TEXT_NORMAL}`)
  }

  if (projects.length === 0) {
    ctx.out(`${Icon.warn} No sub-projects detected in ${ctx.cwd}`)
    return 0
  }

  await Bun.write(path.join(ctx.cwd, WORKSPACE_FILE), JSON.stringify({ projects }, null, 2) + "\n")
  ctx.out(`${Icon.success} Detected ${projects.length} projects — saved to ${WORKSPACE_FILE}`)
}

async function listProjects(ctx: PluginContext): Promise<number | void> {
  const projects = await loadWorkspace(ctx)
  if (projects.length === 0) {
    ctx.out(`${Icon.warn} No workspace found — run: nexus workspace init`)
    return 0
  }
  ctx.out(`${Icon.info} Workspace (${projects.length} projects):`)
  for (const project of projects) {
    ctx.out(`  [${project.name}] ${project.type} ${Style.TEXT_DIM}${project.path}${Style.TEXT_NORMAL}`)
  }
}

function resolveTargets(projects: WorkspaceProject[], selector: string): WorkspaceProject[] {
  if (selector === "all") return projects
  if (selector.startsWith("--exclude ")) {
    const excluded = selector.slice("--exclude ".length).split(",")
    return projects.filter((p) => !excluded.includes(p.name))
  }
  const names = selector.split(",")
  return projects.filter((p) => names.includes(p.name))
}

async function run(ctx: PluginContext): Promise<number | void> {
  let projects = await loadWorkspace(ctx)
  if (projects.length === 0 && typeof ctx.flags.all !== "undefined") {
    ctx.err("No workspace found — run: nexus workspace init")
    return 1
  }

  const [selector, ...rest] = ctx.args
  const command = rest.join(" ") || String(ctx.flags.cmd ?? "")
  if (!selector || !command) {
    ctx.err('Usage: nexus workspace run <name|all|a,b|--exclude mobile> <command>')
    return 1
  }

  projects = resolveTargets(projects, selector)
  if (projects.length === 0) {
    ctx.err(`No matching projects for '${selector}'`)
    return 1
  }

  const procs = projects.map((project) => {
    ctx.out(`${Style.TEXT_INFO_BOLD}[${project.name}]${Style.TEXT_NORMAL} ${Style.TEXT_DIM}$ ${command}${Style.TEXT_NORMAL}`)
    return Bun.spawn(["sh", "-c", command], {
      cwd: path.resolve(ctx.cwd, project.path),
      stdout: "inherit",
      stderr: "inherit",
    })
  })

  const exits = await Promise.all(procs.map((p) => p.exited))
  const failed = exits.filter((e) => e !== 0).length
  if (failed > 0) {
    ctx.err(`${failed}/${projects.length} commands failed`)
    return 1
  }
  ctx.out(`${Icon.success} All ${projects.length} commands completed`)
}

async function sync(ctx: PluginContext): Promise<number | void> {
  const projects = await loadWorkspace(ctx)
  if (projects.length < 2) {
    ctx.out(`${Icon.warn} Sync needs 2+ projects in workspace`)
    return 0
  }

  const versionMaps: Array<Record<string, string>> = []
  for (const project of projects) {
    const pkgPath = path.join(ctx.cwd, project.path, "package.json")
    if (!(await Bun.file(pkgPath).exists())) continue
    const pkg = await Bun.file(pkgPath).json()
    versionMaps.push({
      ...(pkg.dependencies as Record<string, string>),
      ...(pkg.devDependencies as Record<string, string>),
    })
  }

  const counts = new Map<string, Map<string, number>>()
  for (const deps of versionMaps) {
    for (const [name, range] of Object.entries(deps)) {
      const versions = counts.get(name) ?? new Map<string, number>()
      versions.set(range, (versions.get(range) ?? 0) + 1)
      counts.set(name, versions)
    }
  }

  let mismatches = 0
  for (const [name, versions] of counts) {
    if (versions.size > 1 && versions.size >= Math.ceil(versionMaps.length / 2)) {
      mismatches++
      ctx.out(`  ${Icon.warn} ${name}: ${[...versions.keys()].join(" vs ")}`)
    }
  }

  if (mismatches === 0) {
    ctx.out(`${Icon.success} Common dependency versions already aligned`)
    return 0
  }
  ctx.out(`${Style.TEXT_DIM}${mismatches} mismatch(es) found — align manually or ask NEXUS to auto-align (--write coming soon)${Style.TEXT_NORMAL}`)
}

const plugin: NexusPlugin = {
  name: "workspace",
  version: "0.1.0",
  description: "Multi-project workspace manager with parallel execution",
  tags: ["monorepo", "parallel", "workspace"],
  commands: [
    { name: "init", describe: "detect sub-projects and create nexus-workspace.json", usage: "nexus workspace init", run: init },
    { name: "list", describe: "list registered workspace projects", usage: "nexus workspace list", run: listProjects },
    { name: "run", describe: 'run a command in one/all projects, e.g. nexus workspace run all "npm test"', usage: "nexus workspace run <all|names> <cmd>", run: run },
    { name: "sync", describe: "detect common dependency version mismatches across projects", usage: "nexus workspace sync", run: sync },
  ],
}

export default plugin

export * as WorkspacePlugin from "./workspace"
