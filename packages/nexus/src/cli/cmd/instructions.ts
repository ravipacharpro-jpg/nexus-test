import fs from "node:fs"
import path from "node:path"
import { EOL } from "node:os"
import { cmd } from "./cmd"

export const inspectableInstructionFilenames = ["NEXUS.md", "AGENTS.md", "CLAUDE.md", "CONTEXT.md"] as const
export type InspectableInstructionFilename = (typeof inspectableInstructionFilenames)[number]

export type InstructionPathStatus = {
  filename: InspectableInstructionFilename
  path: string
  directory: string
  precedence: number
}

function inside(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))
}

/**
 * Lists only known instruction file names and their paths between a directory and
 * a caller-chosen root. Contents are never opened, parsed, displayed, or changed.
 */
export function inspectInstructionPaths(directory: string, root = directory): InstructionPathStatus[] {
  const resolvedDirectory = path.resolve(directory)
  const resolvedRoot = path.resolve(root)
  if (!inside(resolvedRoot, resolvedDirectory)) {
    throw new Error("Instruction directory must stay within the supplied inspection root.")
  }

  const result: InstructionPathStatus[] = []
  let current = resolvedDirectory
  while (true) {
    for (const [precedence, filename] of inspectableInstructionFilenames.entries()) {
      const candidate = path.join(current, filename)
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        result.push({ filename, path: candidate, directory: current, precedence })
      }
    }
    if (current === resolvedRoot) break
    const parent = path.dirname(current)
    if (parent === current || !inside(resolvedRoot, parent)) break
    current = parent
  }
  return result
}

export function formatInstructionStatus(directory: string, root = directory): string {
  const resolvedDirectory = path.resolve(directory)
  const resolvedRoot = path.resolve(root)
  const entries = inspectInstructionPaths(resolvedDirectory, resolvedRoot)
  const lines = [
    `Instruction inspection root: ${resolvedRoot}`,
    `Directory inspected: ${resolvedDirectory}`,
    `Known filename precedence: ${inspectableInstructionFilenames.join(" -> ")}`,
    "Scope: names and paths only; file contents are not read, displayed, parsed, attached, or modified.",
  ]
  if (entries.length === 0) {
    lines.push("No known instruction filenames were found inside this inspection root.")
  } else {
    lines.push("Known instruction filenames found:")
    for (const entry of entries) {
      lines.push(`- ${entry.filename} (precedence ${entry.precedence + 1}) — ${entry.path}`)
    }
  }
  return lines.join(EOL)
}

export function formatInstructionExplanation(): string {
  return [
    `Known project instruction filenames, in runtime preference order: ${inspectableInstructionFilenames.join(" -> ")}.`,
    "NEXUS project instruction resolution uses known filenames and bounded project/worktree context; this inspection command does not change that resolution.",
    "Instruction text is redacted before it can be attached to runtime context for common key, token, password, secret, and Bearer credential patterns.",
    "This command never prints instruction contents, writes a project file, alters config, loads a plugin, calls a model, or starts a task.",
  ].join(EOL)
}

export const InstructionsStatusCommand = cmd({
  command: "status [directory]",
  describe: "list known project instruction names and paths inside a bounded root; never read contents",
  builder: (yargs) =>
    yargs
      .positional("directory", { type: "string", describe: "directory to inspect; defaults to the current directory" })
      .option("root", { type: "string", describe: "inclusive ancestor boundary; defaults to the inspected directory" }),
  handler(args: { directory?: string; root?: string }) {
    const directory = args.directory ?? process.cwd()
    const root = args.root ?? directory
    process.stdout.write(formatInstructionStatus(directory, root) + EOL)
  },
})

export const InstructionsExplainCommand = cmd({
  command: "explain",
  describe: "explain instruction filename precedence and redaction boundaries without reading files",
  handler() {
    process.stdout.write(formatInstructionExplanation() + EOL)
  },
})

export const InstructionsCommand = cmd({
  command: "instructions",
  aliases: ["instruction"],
  describe: "inspect safe NEXUS project instruction discovery boundaries",
  builder: (yargs) => yargs.command(InstructionsStatusCommand).command(InstructionsExplainCommand).demandCommand(),
  async handler() {},
})
