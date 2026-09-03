import fs from "fs"
import path from "path"
import { Style, Icon } from "../core/style"

const EOL = "\n"
import type { NexusPlugin, PluginContext } from "../core/types"

const ENV_PATTERNS: Array<[RegExp, string]> = [
  [/process\.env\.([A-Z_][A-Z0-9_]*)/g, "js"],
  [/import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g, "js"],
  [/Deno\.env\.get\(\s*["']([A-Z_][A-Z0-9_]*)/g, "js"],
  [/os\.environ(?:\.get)?\(\s*["']([A-Z_][A-Z0-9_]*)/g, "python"],
  [/getenv\(\s*["']([A-Z_][A-Z0-9_]*)/g, "php"],
  [/\$_ENV\[\s*["']([A-Z_][A-Z0-9_]*)/g, "php"],
  [/os\.Getenv\(\s*"([A-Z_][A-Z0-9_]*)"/g, "go"],
  [/env::var\(\s*"([A-Z_][A-Z0-9_]*)"/g, "rust"],
  [/ENV\[\s*["']([A-Z_][A-Z0-9_]*)/g, "ruby"],
]

const SCAN_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".php", ".go", ".rs", ".rb",
])

interface EnvRef {
  name: string
  file: string
  line: number
}

async function walk(dir: string, exclude = new Set(["node_modules", ".git", "dist", "build", ".next", "vendor", "coverage"])): Promise<string[]> {
  const fs = await import("fs/promises")
  let result: string[] = []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return result
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env" && !SCAN_EXTENSIONS.has(path.extname(entry.name))) continue
    if (exclude.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result = [...result, ...(await walk(full))]
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      result.push(full)
    }
  }
  return result
}

async function scanEnv(ctx: PluginContext): Promise<number | void> {
  const target = path.resolve(ctx.cwd, ctx.args[0] ?? ".")
  ctx.out(`${Icon.info} NEXUS Env Detective — scanning ${target}`)

  const files = await walk(target)
  const refs = new Map<string, EnvRef>()

  for (const file of files) {
    const content = await Bun.file(file).text()
    const relPath = path.relative(target, file)
    for (const [index, text] of content.split("\n").entries()) {
      for (const [regex] of ENV_PATTERNS) {
        regex.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = regex.exec(text))) {
          const name = match[1]
          if (!refs.has(name)) refs.set(name, { name, file: relPath, line: index + 1 })
        }
      }
    }
  }

  const envPath = path.join(target, ".env")
  const existing = new Set<string>()
  if (await Bun.file(envPath).exists()) {
    for (const line of (await Bun.file(envPath).text()).split("\n")) {
      const key = line.trim().split("=")[0]?.trim()
      if (key) existing.add(key)
    }
  }

  const names = [...refs.keys()].sort()
  if (names.length === 0) {
    ctx.out(`${Icon.success} No environment variables found in code`)
    return 0
  }

  const missing = names.filter((n) => !existing.has(n))
  ctx.out(`Found ${names.length} environment variables in code`)
  if (existing.size > 0) ctx.out(`${Icon.success} Present in .env (${names.length - missing.length})`)
  for (const ref of missing.map((n) => refs.get(n)!)) {
    ctx.out(`  ${Icon.warn} ${Style.TEXT_WARNING_BOLD}${ref.name}${Style.TEXT_NORMAL} ${Style.TEXT_DIM}→ used in ${ref.file}:${ref.line}${Style.TEXT_NORMAL}`)
  }

  const examplePath = path.join(target, ".env.example")
  await Bun.write(examplePath, names.map((n) => `${n}=`).join("\n") + "\n")
  ctx.out(`${Icon.success} Generated .env.example (${names.length} keys)`)

  if (missing.length > 0 && typeof ctx.flags.sync === "boolean" && ctx.flags.sync) {
    const current = (await Bun.file(envPath).exists()) ? await Bun.file(envPath).text() : ""
    const appended = missing.map((n) => `${n}=`).join("\n")
    await Bun.write(envPath, current + (current.endsWith("\n") || !current ? "" : "\n") + appended + "\n")
    ctx.out(`${Icon.success} Appended ${missing.length} placeholder keys to .env`)
  } else if (missing.length > 0) {
    ctx.out(`${Icon.info} Run with --sync to append placeholders to .env`)
  }
}

async function parsePackageJson(ctx: PluginContext): Promise<Record<string, unknown> | undefined> {
  const pkgPath = path.resolve(ctx.cwd, ctx.args[0] ?? ".", "package.json")
  const file = Bun.file(pkgPath)
  if (!(await file.exists())) return undefined
  return (await file.json()) as Record<string, unknown>
}

async function depsCheck(ctx: PluginContext): Promise<number | void> {
  const pkg = await parsePackageJson(ctx)
  if (!pkg) {
    ctx.err("No package.json found in target directory")
    return 1
  }

  const deps = { ...(pkg.dependencies as object), ...(pkg.devDependencies as object) }
  ctx.out(`${Icon.info} NEXUS Dependency Doctor — ${Object.keys(deps).length} dependencies`)

  const proc = Bun.spawn(["npm", "audit", "--json"], {
    cwd: path.resolve(ctx.cwd, ctx.args[0] ?? "."),
    stdout: "pipe",
    stderr: "ignore",
    env: { ...process.env, npm_config_json: "true" },
  })
  const exit = await proc.exited
  if (exit === 0) {
    ctx.out(`${Icon.success} npm audit: no known vulnerabilities`)
  } else {
    const raw = await new Response(proc.stdout).text()
    try {
      const report = JSON.parse(raw)
      const count = report?.metadata?.vulnerabilities
        ? Object.entries(report.metadata.vulnerabilities).filter(([k]) => k !== "total").reduce((sum: number, [, v]) => sum + ((v as { via?: unknown[] })?.via?.length ?? 0), 0)
        : undefined
      ctx.out(`${Icon.warn} npm audit found issues${count ? ` (${count})` : ""} — run 'npm audit fix' or see 'npm audit' for details`)
    } catch {
      ctx.out(`${Icon.warn} npm audit reported issues — run 'npm audit' for details`)
    }
  }
}

async function depsUnused(ctx: PluginContext): Promise<number | void> {
  const target = path.resolve(ctx.cwd, ctx.args[0] ?? ".")
  const pkgPath = path.join(target, "package.json")
  if (!(await Bun.file(pkgPath).exists())) {
    ctx.err("No package.json found")
    return 1
  }
  const pkg = await Bun.file(pkgPath).json()
  const declared = Object.keys((pkg.dependencies as Record<string, string>) ?? {})
  if (declared.length === 0) {
    ctx.out(`${Icon.success} No runtime dependencies to check`)
    return 0
  }

  const files = await walk(target)
  let codeText = ""
  for (const file of files) {
    if (file.endsWith(".d.ts")) continue
    codeText += (await Bun.file(file).text().catch(() => "")) + "\n"
  }

  const unused = declared.filter((dep) => {
    const patterns = [
      new RegExp(`from ["']${dep.replace(/[/\\]/g, "\\$")}["']`),
      new RegExp(`require\(["']${dep.replace(/[/\\]/g, "\\$")}["']\)`),
      new RegExp(`import\(["']${dep.replace(/[/\\]/g, "\\$")}["']\)`),
      new RegExp(`["']${dep.replace(/[/\\]/g, "\\$")}/`),
    ]
    return !patterns.some((re) => re.test(codeText))
  })

  if (unused.length === 0) {
    ctx.out(`${Icon.success} All ${declared.length} dependencies are used`)
    return 0
  }
  ctx.out(`${Icon.warn} ${unused.length} unused dependency(ies):`)
  for (const dep of unused) ctx.out(`  ${Style.TEXT_WARNING_BOLD}− ${dep}${Style.TEXT_NORMAL}`)
  ctx.out(`${Style.TEXT_DIM}Remove with: npm rm ${unused.join(" ")}${Style.TEXT_NORMAL}`)
  return 1
}

async function depsDuplicates(ctx: PluginContext): Promise<number | void> {
  const target = path.resolve(ctx.cwd, ctx.args[0] ?? ".")
  const proc = Bun.spawn(["bun", "pm", "ls", "--all"], { cwd: target, stdout: "pipe", stderr: "ignore" })
  await proc.exited
  const raw = await new Response(proc.stdout).text()
  const versions = new Map<string, Set<string>>()
  for (const match of raw.matchAll(/^[├└│─\s]*[\w@][\w@./-]*@([\w@][\w@.\/-]*)@([\d][^\s]*)/gm)) {
    const name = match[1] ?? ""
    const ver = match[2] ?? ""
    if (!name || !ver) continue
    const set = versions.get(name) ?? new Set<string>()
    set.add(ver)
    versions.set(name, set)
  }
  const dupes = [...versions.entries()].filter(([, set]) => set.size > 1)
  if (dupes.length === 0) {
    ctx.out(`${Icon.success} No duplicate package versions detected`)
    return 0
  }
  ctx.out(`${Icon.warn} ${dupes.length} package(s) installed in multiple versions:`)
  for (const [name, set] of dupes.slice(0, 20)) {
    ctx.out(`  ${name}: ${[...set].join(", ")}`)
  }
  return 1
}

const DOCTOR_LOG = path.join(process.env.HOME ?? ".", ".nexus", "doctor-history.jsonl")

function recordHistory(hits: Array<{ error: string; what: string; fix: string }>): void {
  if (hits.length === 0) return
  const line = JSON.stringify({ ts: Date.now(), ...hits[0] }) + "\n"
  try {
    fs.appendFileSync(DOCTOR_LOG, line)
  } catch {}
}

async function doctorHistory(ctx: PluginContext): Promise<number | void> {
  if (!(await Bun.file(DOCTOR_LOG).exists())) {
    ctx.out(`${Icon.info} No history yet — run doctor:watch or doctor:explain first`)
    return 0
  }
  const lines = (await Bun.file(DOCTOR_LOG).text()).trim().split("\n").slice(-20)
  ctx.out(`${Icon.info} Last ${lines.length} error(s):`)
  for (const line of lines.reverse()) {
    try {
      const entry = JSON.parse(line) as { ts: number; what: string; fix: string }
      ctx.out(`  ${new Date(entry.ts).toLocaleString()} — ${entry.what}`)
      ctx.out(`     ${Style.TEXT_DIM}${entry.fix}${Style.TEXT_NORMAL}`)
    } catch {}
  }
  return 0
}

async function apiScan(ctx: PluginContext): Promise<number | void> {
  const target = path.resolve(ctx.cwd, ctx.args[0] ?? "./src")
  const files = await walk(target)
  const routes: Array<{ method: string; routePath: string; file: string }> = []
  const ROUTE_RE = /\.(get|post|put|patch|delete|all)\(\s*["'`]([^"'`]+)["'`]/g

  for (const file of files) {
    const content = await Bun.file(file).text()
    let match: RegExpExecArray | null
    while ((match = ROUTE_RE.exec(content))) {
      routes.push({ method: match[1].toUpperCase(), routePath: match[2], file: path.relative(target, file) })
    }
  }

  if (routes.length === 0) {
    ctx.out(`${Icon.warn} No HTTP routes detected in ${target}`)
    return 0
  }

  ctx.out(`${Icon.info} Found ${routes.length} routes:`)
  for (const r of routes.sort((a, b) => a.routePath.localeCompare(b.routePath))) {
    ctx.out(`  ${Style.TEXT_INFO_BOLD}${r.method.padEnd(7)}${Style.TEXT_NORMAL} ${r.routePath.padEnd(30)} ${Style.TEXT_DIM}${r.file}${Style.TEXT_NORMAL}`)
  }

  if (typeof ctx.flags.format === "string" && ctx.flags.format === "openapi") {
    const paths = routes
      .map((r) => `  /${r.routePath.replace(/^\//, "")}:\n    ${r.method.toLowerCase()}:\n      summary: ${r.method} ${r.routePath}\n      responses:\n        '200':\n          description: OK`)
      .join("\n")
    const yaml = `openapi: 3.0.0\ninfo:\n  title: Generated API\n  version: 1.0.0\npaths:\n${paths}\n`
    const out = path.join(target, "openapi.yaml")
    await Bun.write(out, yaml)
    ctx.out(`${Icon.success} Generated ${out} (OpenAPI 3.0)`)
  }

  if (typeof ctx.flags.format === "string" && ctx.flags.format === "markdown") {
    const md = [
      "# API Reference (generated by NEXUS)",
      "",
      "| Method | Path | File |",
      "|--------|------|------|",
      ...routes.map((r) => `| ${r.method} | \`${r.routePath}\` | ${r.file} |`),
    ].join("\n")
    const out = path.join(target, "API.md")
    await Bun.write(out, md + "\n")
    ctx.out(`${Icon.success} Generated ${out}`)
  }
}

const ERROR_DB: Array<[RegExp, string, string]> = [
  [/Cannot find module ['"]([^'"]+)['"]/i, "Module not found", "Install it (npm/bun add <pkg>) or fix the import path"],
  [/EADDRINUSE.*?(\d+)/i, "Port already in use", "Kill it: npx kill-port PORT or lsof -ti:PORT | xargs kill"],
  [/EACCES|permission denied/i, "Permission denied", "Check file ownership: chmod/chown; never use sudo with node"],
  [/TS2307: Cannot find module/i, "TypeScript module resolution", "Check relative path/extension or add missing @types package"],
  [/ECONNREFUSED/i, "Connection refused", "Target service is down — check DB/redis/docker status"],
  [/ER_ACCESS_DENIED|Access denied for user/i, "DB auth failed", "Verify DB user/password and host allowlist"],
  [/Merge conflict in/i, "Git conflict", "Edit conflicted files, then git add + commit"],
  [/Cannot read propert(y|ies) of (null|undefined)/i, "Null/undefined access", "Guard the value with ?. or an early return before use"],
  [/out of memory|JavaScript heap/i, "Out of memory", "Raise heap: NODE_OPTIONS=--max-old-space-size=4096"],
]

function matchErrors(text: string): Array<{ error: string; what: string; fix: string }> {
  const found: Array<{ error: string; what: string; fix: string }> = []
  for (const line of text.split("\n")) {
    for (const [regex, what, fix] of ERROR_DB) {
      if (regex.test(line)) {
        found.push({ error: line.trim().slice(0, 160), what, fix })
        break
      }
    }
  }
  return found
}

async function doctorWatch(ctx: PluginContext): Promise<number | void> {
  const command = ctx.args.join(" ")
  if (!command) {
    ctx.err("Usage: nexus devtools doctor:watch <command>  (e.g. doctor:watch npm run build)")
    return 1
  }
  ctx.out(`${Icon.info} Log Doctor watching: ${command}`)
  const proc = Bun.spawn(["sh", "-c", command], { cwd: ctx.cwd, stdout: "pipe", stderr: "pipe" })

  const scan = async (stream: ReadableStream<Uint8Array> | undefined, label: string) => {
    if (!stream) return
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        const hits = matchErrors(line)
        process.stderr.write(line + EOL)
        for (const hit of hits) {
          ctx.out(`  ${Icon.bug} ${Style.TEXT_WARNING_BOLD}${hit.what}${Style.TEXT_NORMAL}`)
          ctx.out(`     ${Style.TEXT_DIM}Fix: ${hit.fix}${Style.TEXT_NORMAL}`)
        }
      }
    }
  }

  await Promise.all([scan(proc.stdout, "out"), scan(proc.stderr, "err")])
  const code = await proc.exited
  ctx.out(code === 0 ? `${Icon.success} Command finished clean` : `${Icon.fail} Command exited with ${code}`)
  return code === 0 ? 0 : 1
}

async function doctorExplain(ctx: PluginContext): Promise<number | void> {
  const file = typeof ctx.flags.file === "string" ? ctx.flags.file : undefined
  const text = file
    ? await Bun.file(path.resolve(ctx.cwd, file)).text()
    : ctx.args.join(" ")

  if (!text.trim()) {
    ctx.err("Usage: nexus devtools doctor:explain \"<error text>\"  (or --file error.log)")
    return 1
  }
  const hits = matchErrors(text)
  if (hits.length === 0) {
    ctx.out(`${Icon.warn} No known error pattern matched — connect an LLM (api add) for deep analysis.`)
    return 1
  }
  for (const hit of hits) {
    ctx.out(`${Icon.brain} ${Style.TEXT_HIGHLIGHT_BOLD}${hit.what}${Style.TEXT_NORMAL}`)
    ctx.out(`   ${Style.TEXT_DIM}${hit.error}${Style.TEXT_NORMAL}`)
    ctx.out(`   ${Style.TEXT_SUCCESS}Fix: ${hit.fix}${Style.TEXT_NORMAL}`)
  }
  return 0
}

async function envCheck(ctx: PluginContext): Promise<number | void> {
  const target = path.resolve(ctx.cwd, ctx.args[0] ?? ".")
  const envPath = path.join(target, ".env")
  if (!(await Bun.file(envPath).exists())) {
    ctx.err(`No .env in ${target} — run env:scan --sync first`)
    return 1
  }
  const existing = new Set(
    (await Bun.file(envPath).text())
      .split("\n")
      .map((l) => l.split("=")[0]?.trim())
      .filter(Boolean) as string[],
  )
  const files = await walk(target)
  const used = new Set<string>()
  for (const file of files) {
    const content = await Bun.file(file).text()
    for (const [regex] of ENV_PATTERNS) {
      regex.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = regex.exec(content))) used.add(match[1])
    }
  }
  const missing = [...used].filter((n) => !existing.has(n))
  const unused = [...existing].filter((n) => !used.has(n) && n !== "PATH")

  ctx.out(`${Icon.info} .env check for ${target}`)
  for (const name of missing) ctx.out(`  ${Icon.fail} missing: ${Style.TEXT_DANGER_BOLD}${name}${Style.TEXT_NORMAL}`)
  for (const name of unused) ctx.out(`  ${Icon.warn} unused : ${Style.TEXT_DIM}${name}${Style.TEXT_NORMAL}`)
  if (missing.length === 0 && unused.length === 0) ctx.out(`  ${Icon.success} .env perfectly in sync with code`)
  return missing.length > 0 ? 1 : 0
}

async function envValidate(ctx: PluginContext): Promise<number | void> {
  const target = path.resolve(ctx.cwd, ctx.args[0] ?? ".")
  const envPath = path.join(target, ".env")
  if (!(await Bun.file(envPath).exists())) {
    ctx.err(`No .env in ${target}`)
    return 1
  }
  const empty: string[] = []
  for (const line of (await Bun.file(envPath).text()).split("\n")) {
    const [key, ...rest] = line.split("=")
    const value = rest.join("=").trim()
    if (key?.trim() && !value) empty.push(key.trim())
  }
  if (empty.length > 0) {
    ctx.out(`${Icon.fail} ${empty.length} required var(s) empty: ${Style.TEXT_DANGER_BOLD}${empty.join(", ")}${Style.TEXT_NORMAL}`)
    return 1
  }
  ctx.out(`${Icon.success} All .env values are set`)
  return 0
}

async function depsOutdated(ctx: PluginContext): Promise<number | void> {
  const target = path.resolve(ctx.cwd, ctx.args[0] ?? ".")
  const proc = Bun.spawn(["npm", "outdated", "--json"], { cwd: target, stdout: "pipe", stderr: "ignore" })
  const exit = await proc.exited
  const raw = await new Response(proc.stdout).text()
  if (!raw.trim()) {
    ctx.out(`${Icon.success} All packages up to date`)
    return 0
  }
  try {
    const data = JSON.parse(raw) as Record<string, { current?: string; wanted?: string; latest?: string }>
    const rows = Object.entries(data)
    ctx.out(`${Icon.warn} ${rows.length} outdated package(s):`)
    for (const [name, info] of rows) {
      ctx.out(`  ${name.padEnd(24)} ${info.current ?? "-"} → ${Style.TEXT_INFO_BOLD}${info.latest ?? "-"}${Style.TEXT_NORMAL}`)
    }
  } catch {
    ctx.out(raw.trim())
  }
  return exit === 0 ? 0 : 1
}

async function envDoctor(ctx: PluginContext): Promise<number | void> {
  const fix = ctx.flags.fix === true
  const isTermuxEnv = !!process.env.TERMUX_VERSION || !!process.env.PREFIX?.includes("com.termux")
  let problems = 0

  ctx.out(`${Icon.brain} NEXUS Environment Doctor ${isTermuxEnv ? Style.TEXT_DIM + "(Termux mode)" + Style.TEXT_NORMAL : ""}`)

  const needBinaries: Array<[string, string]> = [
    ["git", "pkg install git"],
    ["curl", "pkg install curl"],
    ["tar", "pkg install tar"],
    ["unzip", "pkg install unzip"],
    ["rg", "pkg install ripgrep"],
    ["node", "pkg install nodejs-lts"],
    ["bun", "curl -fsSL https://bun.sh/install | bash"],
  ]
  for (const [bin, installCmd] of needBinaries) {
    if (Bun.which(bin)) {
      ctx.out(`  ${Icon.success} ${bin}`)
      continue
    }
    problems++
    ctx.out(`  ${Icon.fail} ${bin} missing`)
    if (fix && !bin.startsWith("bun")) {
      const proc = Bun.spawn(["sh", "-c", installCmd], { stdout: "ignore", stderr: "ignore" })
      const okNow = (await proc.exited) === 0 && !!Bun.which(bin)
      ctx.out(`     ${okNow ? Icon.success + " installed now" : Icon.warn + " fix failed — run manually: " + installCmd}`)
      if (!okNow) problems++
    } else {
      ctx.out(`     ${Style.TEXT_DIM}fix: ${installCmd}${Style.TEXT_NORMAL}`)
    }
  }

  if (isTermuxEnv && Bun.which("bun")) {
    const bunStore = path.join(ctx.cwd, "node_modules", ".bun")
    ctx.out(`  ${Icon.info} Termux known-issue guard: bun install segfault-retry available`)
    if (fix) {
      ctx.out(`     ${Icon.rocket} Running resilient install loop (backend=copyfile)...`)
      for (let i = 0; i < 40; i++) {
        const proc = Bun.spawn(["bun", "install", "--backend=copyfile"], { cwd: ctx.cwd, stdout: "ignore", stderr: "ignore" })
        await proc.exited
        const count = await import("fs/promises")
          .then((f) => f.readdir(path.join(ctx.cwd, "node_modules", ".bun")).catch(() => [] as string[]))
          .then((entries) => entries.length)
        ctx.out(`     pass ${i + 1}: store=${count}`)
        if (proc.exitCode === 0) break
      }
    }
  }

  ctx.out(problems === 0 ? `${Icon.success} Environment healthy!` : `${Icon.warn} ${problems} issue(s) ${fix ? "(attempted)" : ""} — rerun with --fix`)
}

async function doctorFix(ctx: PluginContext): Promise<number | void> {
  ctx.out(`${Icon.rocket} Applying last suggested fix...`)
  const last = path.join(process.env.HOME ?? ".", ".nexus", "last-fix.sh")
  if (!(await Bun.file(last).exists())) {
    ctx.err("No pending fix recorded — run doctor:watch/explain first")
    return 1
  }
  const script = await Bun.file(last).text()
  const proc = Bun.spawn(["bash", "-c", script], { cwd: ctx.cwd, stdout: "inherit", stderr: "inherit" })
  return (await proc.exited) === 0 ? 0 : 1
}

const plugin: NexusPlugin = {
  name: "devtools",
  version: "0.1.0",
  description: "Env Detective, Dependency Doctor and API documenter",
  tags: ["env", "dependencies", "audit", "api-docs"],
  commands: [
    { name: "env:scan", describe: "scan codebase for env vars vs .env, generate .env.example", usage: "nexus devtools env:scan [dir] [--sync]", run: scanEnv },
    { name: "deps:check", describe: "dependency health check with npm audit", usage: "nexus devtools deps:check [dir]", run: depsCheck },
    { name: "api:scan", describe: "detect HTTP routes and optionally emit API.md (--format markdown)", usage: "nexus devtools api:scan [dir]", run: apiScan },
    { name: "env:check", describe: "compare .env against code usage (missing + unused)", usage: "nexus devtools env:check [dir]", run: envCheck },
    { name: "env:validate", describe: "fail if any .env var is empty", usage: "nexus devtools env:validate [dir]", run: envValidate },
    { name: "deps:outdated", describe: "list outdated packages with latest versions", usage: "nexus devtools deps:outdated [dir]", run: depsOutdated },
    { name: "deps:unused", describe: "find declared-but-never-imported dependencies", usage: "nexus devtools deps:unused [dir]", run: depsUnused },
    { name: "deps:duplicates", describe: "detect packages installed in multiple versions", usage: "nexus devtools deps:duplicates [dir]", run: depsDuplicates },
    { name: "doctor:watch", describe: "run a command and auto-suggest fixes for errors in real time", usage: 'nexus devtools doctor:watch "npm run build"', run: doctorWatch },
    { name: "doctor:explain", describe: "explain an error and suggest a fix", usage: 'nexus devtools doctor:explain "Cannot find module x"  (--file log.txt)', run: doctorExplain },
  ],
}

export default plugin

export * as DevtoolsPlugin from "./devtools"
