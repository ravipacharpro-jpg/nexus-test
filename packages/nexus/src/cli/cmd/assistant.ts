import path from "path"
import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Orchestrator } from "@nexus-ai/assistant/core/orchestrator"
import { PluginManager } from "@nexus-ai/assistant/core/plugin-manager"
import { detectEnvironment } from "@nexus-ai/assistant/core/adaptive"
import { makeContext, SECURITY_RULES } from "@nexus-ai/assistant/core/security"
import { Style, Icon } from "@nexus-ai/assistant/core/style"
import { EOL } from "os"
import { AgentPlatformStore } from "../../agent-platform/store"

const manager = new PluginManager(detectEnvironment())

const FLAG_OPTIONS = [
  ["out", { type: "string", describe: "output path" }],
  ["port", { type: "number", describe: "port" }],
  ["url", { type: "string", describe: "target url" }],
  ["scenario", { type: "string", describe: "test scenario" }],
  ["host", { type: "string", describe: "remote host" }],
  ["user", { type: "string", describe: "remote user" }],
  ["key", { type: "string", describe: "key file path" }],
  ["local", { type: "string", describe: "local path" }],
  ["remote", { type: "string", describe: "remote path" }],
  ["branch", { type: "string", describe: "git branch" }],
  ["name", { type: "string", describe: "name" }],
  ["domain", { type: "string", describe: "domain" }],
  ["path", { type: "string", describe: "path" }],
  ["from", { type: "string", describe: "source language" }],
  ["to", { type: "string", describe: "target language" }],
  ["format", { type: "string", describe: "output format" }],
  ["message", { type: "string", alias: "m", describe: "commit message" }],
  ["browser", { type: "string", describe: "browser (chrome|edge)" }],
  ["confirm", { type: "boolean", describe: "explicitly approve applicable confirmation prompts for this command" }],
  ["stage", { type: "boolean", describe: "explicitly stage reviewed local changes before a Git commit" }],
  ["patch", { type: "boolean", describe: "show a bounded patch preview in addition to the change summary" }],
  ["force", { type: "boolean", describe: "force overwrite" }],
  ["sync", { type: "boolean", describe: "sync placeholders" }],
  ["noVerify", { type: "boolean", describe: "legacy option; critical secret checks remain mandatory" }],
  // yargs interprets `--no-verify` as negation of `verify` before camel-case
  // aliases are resolved. Keep that legacy spelling parseable without allowing it
  // to affect the unconditional critical-secret gate in Git Pro.
  ["verify", { type: "boolean", hidden: true, describe: "legacy negation target" }],
  ["dryRun", { type: "boolean", describe: "show what would happen" }],
  ["newProfile", { type: "boolean", describe: "isolated browser profile" }],
  ["connectExisting", { type: "boolean", describe: "attach only to a user-started loopback CDP browser" }],
  ["authorizeTarget", { type: "boolean", describe: "confirm ownership or authorization for a browser/HTTP target" }],
  ["allowInteraction", { type: "boolean", describe: "allow one human-confirmed non-sensitive browser interaction" }],
  ["voiceCommand", { type: "string", describe: "one-shot voice command text" }],
  ["learn", { type: "boolean", describe: "create a redacted learning proposal after a successful task; approval remains required" }],
  ["task", { type: "string", describe: "task description" }],
] as const

export const AssistantCommand = cmd({
  command: "assistant [input..]",
  describe: "NEXUS assistant — natural language tasks + on-demand plugins",
  builder: (yargs) => {
    let builder = yargs
      .positional("input", {
        describe:
          'natural language query or plugin command, e.g. "react app banao" | code generate "todo app" --out ./todo',
        type: "string",
        array: true,
      })
    for (const [name, opts] of FLAG_OPTIONS) {
      builder = builder.option(name as string, opts as never)
    }
    return builder
  },
  handler: async (args) => {
    const tokens = (args.input ?? []).filter((token) => typeof token === "string") as string[]
    const cwd = process.cwd()

    if (tokens.length === 0 || tokens[0] === "help") {
      printHelp()
      return
    }

    if (tokens[0] === "list") {
      await printCatalog()
      return
    }

    if (tokens[0] === "undo-ai") {
      const marker = Bun.file(path.join(process.env.HOME ?? cwd, ".nexus", "last-ai-snapshot"))
      if (!(await marker.exists())) {
        process.stderr.write(`${Icon.fail} No AI snapshot found${EOL}`)
        process.exitCode = 1
        return
      }
      const [snapName, projectPath] = (await marker.text()).trim().split("\n")
      process.env.NEXUS_ASSUME_YES = "1"
      await dispatch("recovery", ["restore", snapName], { ...args, _cwd: projectPath })
      delete process.env.NEXUS_ASSUME_YES
      return
    }

    if (tokens[0] === "security") {
      process.stderr.write(`${Style.TEXT_NORMAL_BOLD}NEXUS security rules:${Style.TEXT_NORMAL}${EOL}`)
      for (const rule of SECURITY_RULES) process.stderr.write(`  ${Icon.lock} ${rule}${EOL}`)
      return
    }

    const pluginName = manager.available().find((name) => name === tokens[0] || name.startsWith(tokens[0]))
    if (pluginName) {
      const code = await dispatch(pluginName, tokens.slice(1), args)
      if (code === 0) captureLearningProposal(tokens, args)
      return
    }

    const orchestrator = new Orchestrator()
    const nlFlags: Record<string, unknown> = { ...args }
    delete nlFlags.input
    delete nlFlags._
    delete nlFlags["--"]
    delete nlFlags.$0
    const code = await orchestrator.process(tokens.join(" "), cwd, undefined, nlFlags)
    if (code === 0) captureLearningProposal(tokens, args)
    if (code !== 0) process.exitCode = code
  },
})

async function dispatch(pluginName: string, rest: string[], args: Record<string, unknown>): Promise<number> {
  const cwd = process.cwd()
  let plugin
  try {
    plugin = await manager.get(pluginName)
  } catch (error) {
    process.stderr.write(`${Icon.fail} ${error instanceof Error ? error.message : String(error)}${EOL}`)
    process.exitCode = 1
    return 1
  }

  const [maybeCommand, ...commandArgs] = rest
  const command =
    (maybeCommand ? plugin.commands.find((c) => c.name === maybeCommand || c.name.split(":").includes(maybeCommand)) : undefined) ??
    (plugin.commands.length === 1 ? plugin.commands[0] : undefined)

  if (!command || maybeCommand === "--help" || maybeCommand === "help") {
    process.stderr.write(`${Icon.plugin} ${plugin.name} v${plugin.version} — ${plugin.description}${EOL}`)
    for (const c of plugin.commands) {
      process.stderr.write(`  ${Style.TEXT_INFO}${c.name.padEnd(20)}${Style.TEXT_NORMAL}${Style.TEXT_DIM}${c.usage ?? c.describe}${Style.TEXT_NORMAL}${EOL}`)
    }
    return 1
  }

  const flags: Record<string, unknown> = { ...args }
  delete flags.input
  delete flags._
  delete flags["--"]
  delete flags.$0

  const ctx = makeContext({
    cwd,
    env: detectEnvironment(),
    args: commandArgs,
    flags,
    out: (message) => process.stderr.write(message + EOL),
    err: (message) => process.stderr.write(`${Style.TEXT_DANGER}${message}${Style.TEXT_NORMAL}${EOL}`),
  })

  const result = await command.run(ctx)
  const code = typeof result === "number" ? result : 0
  if (code !== 0) process.exitCode = code
  return code
}

function captureLearningProposal(tokens: string[], args: Record<string, unknown>) {
  if (args.learn !== true) return
  const intent = tokens.join(" ").trim()
  if (!intent) return
  const store = new AgentPlatformStore()
  try {
    const run = store.createRun({ policy: { maxChildren: 0, maxParallel: 1, budgetClass: "low" } })
    const proposal = store.proposeLearning({
      runId: run.id,
      title: `Reusable workflow: ${intent.slice(0, 80)}`,
      summary: `Successful local task completed for the redacted intent: ${intent}`,
      skillDraft: `For a task matching "${intent}", inspect the current project, preserve existing data, and require confirmation before any external or destructive action.`,
      evidence: ["Task completed successfully through the local NEXUS Assistant."],
    })
    process.stderr.write(`${Icon.lock} Learning proposal ${proposal.id} saved. Review explicitly: nexus agent learning approve ${proposal.id}${EOL}`)
  } catch (error) {
    process.stderr.write(`${Style.TEXT_WARNING}Learning proposal was not saved: ${error instanceof Error ? error.message : String(error)}${Style.TEXT_NORMAL}${EOL}`)
  } finally {
    store.close()
  }
}

function printHelp() {
  process.stderr.write(`${Icon.robot} ${Style.TEXT_HIGHLIGHT_BOLD}NEXUS Assistant${Style.TEXT_NORMAL}${EOL}`)
  process.stderr.write(`${Style.TEXT_DIM}Natural language ya direct plugin commands — sab on-demand load hote hain.${Style.TEXT_NORMAL}${EOL}${EOL}`)
  process.stderr.write(`${Style.TEXT_NORMAL_BOLD}Examples:${Style.TEXT_NORMAL}${EOL}`)
  process.stderr.write(`  ${Style.TEXT_HIGHLIGHT}nexus "ek react app banao"${Style.TEXT_NORMAL}${EOL}`)
  process.stderr.write(`  ${Style.TEXT_HIGHLIGHT}nexus code generate "todo app" --out ./todo${Style.TEXT_NORMAL}${EOL}`)
  process.stderr.write(`  ${Style.TEXT_HIGHLIGHT}nexus devtools env:scan${Style.TEXT_NORMAL}${EOL}`)
  process.stderr.write(`  ${Style.TEXT_HIGHLIGHT}nexus recovery save "before-refactor"${Style.TEXT_NORMAL}${EOL}${EOL}`)
  process.stderr.write(`${Style.TEXT_NORMAL_BOLD}Plugins:${Style.TEXT_NORMAL} nexus list | Security rules: nexus security${EOL}`)
}

async function printCatalog() {
  process.stderr.write(`${Icon.plugin} Available plugins:${EOL}`)
  for (const name of manager.available()) {
    try {
      const plugin = await manager.get(name)
      process.stderr.write(`  ${Style.TEXT_INFO_BOLD}${plugin.name.padEnd(14)}${Style.TEXT_NORMAL}${plugin.description}${EOL}`)
      await manager.unload(name)
    } catch (error) {
      process.stderr.write(`  ${Style.TEXT_WARNING_BOLD}${name.padEnd(14)}${Style.TEXT_NORMAL}${Style.TEXT_DIM}${error instanceof Error ? error.message : "unavailable"}${Style.TEXT_NORMAL}${EOL}`)
    }
  }
}
