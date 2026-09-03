import { access } from "node:fs/promises"
import { join } from "node:path"
import { BaseAgent, type AgentContext } from "./BaseAgent"

export class DebugAgent extends BaseAgent {
  readonly name = "debug-agent"
  readonly systemPrompt = "Validate generated Termux files and report missing artifacts without running destructive commands."

  async execute(_task: string, context: AgentContext) {
    if (!context.outputDir) return { ok: true, checked: [] }
    const expected = context.hiredWorkers.includes("telegram-bot") ? ["main.py", "run.sh", "install.sh"] : ["run.sh"]
    const missing: string[] = []
    for (const file of expected) {
      try {
        await access(join(context.outputDir, file))
      } catch {
        missing.push(file)
      }
    }
    return { ok: missing.length === 0, checked: expected, missing }
  }
}
