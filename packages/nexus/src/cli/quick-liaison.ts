import { EOL } from "node:os"
import type { UserLiaison } from "@nexus/termux-core"

const assistantPluginAliases = new Set([
  "code", "codegen", "copilot", "cpanel", "deploy", "devtools", "gitpro", "integrations", "recovery", "security", "termux", "translate", "translator", "undo-ai", "voice", "webtest", "workspace",
])

const knownCommands = new Set([
  "acp", "agent", "api", "asset", "assistant", "attach", "bot", "completion", "config", "console", "db", "debug", "dev", "do", "export", "generate", "github", "import", "intent", "liaison", "mcp", "mod", "models", "pr", "providers", "run", "serve", "session", "setup", "stats", "tui", "uninstall", "upgrade", "web", ...assistantPluginAliases,
])

/**
 * Keep direct plugin commands documented by the Assistant package out of the
 * bare-task liaison. This preserves existing natural-language bare tasks while
 * making `nexus voice say` equivalent to `nexus assistant voice say`.
 */
export function routeAssistantPluginArgs(args: string[]) {
  return assistantPluginAliases.has(args[0] ?? "") ? ["assistant", ...args] : args
}

export function isBareUserTask(args: string[]) {
  return args.length > 0 && !args[0]?.startsWith("-") && !knownCommands.has(args[0] ?? "")
}

export async function runBareUserTask(args: string[], dependencies: {
  liaison?: UserLiaison
  write?: (text: string) => void
  writeError?: (text: string) => void
} = {}) {
  const { UserLiaison } = await import("@nexus/termux-core")
  const write = dependencies.write ?? process.stdout.write.bind(process.stdout)
  const writeError = dependencies.writeError ?? process.stderr.write.bind(process.stderr)
  const liaison = dependencies.liaison ?? new UserLiaison({
    onUpdate(status) {
      if (!["Complete", "Failed", "Paused", "Cancelled", "Needs review"].includes(status.status)) return
      const detail = status.result?.summary ?? status.error ?? status.status
      write(`NEXUS task ${status.taskId}: ${detail}${EOL}`)
    },
  })
  try {
    const response = await liaison.handleUserMessage(args.join(" "), "local", process.cwd())
    write(response + EOL)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeError(`❌ Task failed: ${message}${EOL}`)
    process.exitCode = 1
  }
}
