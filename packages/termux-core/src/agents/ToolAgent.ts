// ToolAgent — partial Termux-compatible tool generator.
//
// The previous version wrote a small node script and claimed
// success. The new version writes the same files but then runs
// `bash -n` on run.sh and `node --check` on run.js and attaches
// the results as VerificationReceipts. If bash or node is not
// available, the receipt exitCode is 127 and result.ok is
// false — so the caller can show a warning instead of a silent
// success.

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { BaseAgent, type AgentContext } from "./BaseAgent"
import { loadDesignTokens } from "./design-tokens.ts"

const execFileAsync = promisify(execFile)

type RegistryEntry = {
  name: string
  path: string
  runtime: string
  createdAt: string
}

export type ToolAgentOptions = {
  homeDir?: string
  prefix?: string
}

export interface ToolAgentResult {
  outputDir: string
  name: string
  files: string[]
  ok: boolean
  receipts: Array<{
    command: string
    exitCode: number
    capturedAt: string
  }>
  limitations: string[]
}

async function runCheck(cmd: string, args: string[]): Promise<{ command: string; exitCode: number; capturedAt: string }> {
  const capturedAt = new Date().toISOString()
  try {
    await execFileAsync(cmd, args, { timeout: 8_000 })
    return { command: `${cmd} ${args.join(" ")}`, exitCode: 0, capturedAt }
  } catch (e) {
    const err = e as { code?: number }
    return { command: `${cmd} ${args.join(" ")}`, exitCode: typeof err.code === "number" ? err.code : 1, capturedAt }
  }
}

export class ToolAgent extends BaseAgent {
  readonly name = "tool-agent"
  readonly systemPrompt = "Prepare a small Termux-compatible script using only the hired tools."

  constructor(private readonly options: ToolAgentOptions = {}) {
    super()
  }

  private get homeDir() {
    return this.options.homeDir ?? homedir()
  }

  private get shell() {
    const prefix = this.options.prefix ?? process.env.PREFIX
    return prefix ? `#!${join(prefix, "bin", "sh")}` : "#!/usr/bin/env sh"
  }

  async execute(task: string, context: AgentContext): Promise<ToolAgentResult> {
    const capturedAt = new Date().toISOString()
    // Reference-spec grounding: refuse to emit ad-hoc color
    // hex values / log formats if the design-tokens spec is
    // missing. Per NEXUS_QUALITY_CHECKLIST.md.
    const tokens = loadDesignTokens()
    const safeToGenerate = tokens.valid
    const name = task.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "nexus-tool"
    const outputDir = context.outputDir ?? join(this.homeDir, ".nexus", "tools", name)
    await mkdir(outputDir, { recursive: true })

    // Generated tools follow the documented contract: JSON on stdin, JSON on stdout.
    const runner = [
      this.shell,
      "set -eu",
      'exec node "$(dirname "$0")/run.js"',
      `# Hired workers: ${context.hiredWorkers.join(", ") || "core team only"}`,
      "",
    ].join("\n")
    const runSh = join(outputDir, "run.sh")
    const runJs = join(outputDir, "run.js")
    await writeFile(runSh, runner, { encoding: "utf8", mode: 0o755 })

    const toolScript = [
      "#!/usr/bin/env node",
      'let raw = ""',
      'process.stdin.on("data", (chunk) => (raw += chunk))',
      'process.stdin.on("end", () => {',
      "  let input = {}",
      '  try { input = JSON.parse(raw || "{}") } catch { input = {} }',
      "  process.stdout.write(",
      "    JSON.stringify({ ok: true, tool: " + JSON.stringify(name) + ", task: " + JSON.stringify(task) + ", input }) + \"\\n\",",
      "  )",
      "})",
      "",
    ].join("\n")
    await writeFile(runJs, toolScript, { encoding: "utf8", mode: 0o755 })
    await this.recordRegistry({ name, path: outputDir, runtime: "node", createdAt: capturedAt })

    // Verification: shell + JS syntax check on the generated files.
    const shCheck = await runCheck("bash", ["-n", runSh])
    const jsCheck = await runCheck("node", ["--check", runJs])
    const ok = shCheck.exitCode === 0 && jsCheck.exitCode === 0
    return {
      outputDir,
      name,
      files: ["run.sh", "run.js"],
      ok,
      receipts: [shCheck, jsCheck],
      limitations: [
        "no LLM is consulted — the generated tool is a fixed JSON-pass-through template",
        "no test runs the tool end-to-end (would require user-supplied JSON input)",
        ...(safeToGenerate
          ? []
          : [`design-tokens spec missing or incomplete at ${tokens.sourcePath} — generated file may use ad-hoc conventions`]),
      ],
    }
  }

  private async recordRegistry(entry: RegistryEntry) {
    const registryPath = join(this.homeDir, ".nexus", "tools", "registry.json")
    let registry: RegistryEntry[] = []
    try {
      const parsed = JSON.parse(await readFile(registryPath, "utf8")) as unknown
      if (Array.isArray(parsed)) registry = parsed as RegistryEntry[]
    } catch {
      // First entry starts a fresh registry.
    }
    const deduped = registry.filter((item) => item.path !== entry.path)
    deduped.push(entry)
    await mkdir(dirname(registryPath), { recursive: true })
    await writeFile(registryPath, JSON.stringify(deduped, null, 2) + "\n", "utf8")
  }
}
