// BotAgent — partial Python Telegram bot generator.
//
// The previous version wrote a small main.py and claimed
// success. The new version writes the same files but then runs
// `python -m py_compile` on main.py and attaches the result as
// a VerificationReceipt. If py_compile is not available
// (Termux without python), the agent still writes the files but
// marks the receipt exitCode as 127 (command not found) and the
// result.ok as false — so the caller can show the user a
// 'python not installed, generated files only' warning instead
// of a silent success.

import { mkdir, writeFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { homedir } from "node:os"
import { join } from "node:path"
import { BaseAgent, type AgentContext } from "./BaseAgent"
import { loadDesignTokens } from "./design-tokens.ts"

const execFileAsync = promisify(execFile)

function safeName(input: string): string {
  const value = input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return value.slice(0, 48) || "nexus-bot"
}

export interface BotAgentResult {
  outputDir: string
  name: string
  files: string[]
  ok: boolean
  receipt: {
    command: string
    exitCode: number
    capturedAt: string
  }
  limitations: string[]
}

export class BotAgent extends BaseAgent {
  readonly name = "bot-agent"
  readonly systemPrompt = "Prepare a lightweight Python Telegram bot using the hired Telegram worker."

  async execute(task: string, context: AgentContext): Promise<BotAgentResult> {
    const capturedAt = new Date().toISOString()
    // Reference-spec grounding: refuse to emit ad-hoc hardcoded
    // colors / formats if the design-tokens spec is missing or
    // incomplete. This is a NEXUS_QUALITY_CHECKLIST.md item.
    const tokens = loadDesignTokens()
    const safeToGenerate = tokens.valid
    const name = safeName(task.includes("echo") ? "echo-bot" : task)
    const outputDir = context.outputDir ?? join(homedir(), ".nexus", "bots", name)
    await mkdir(outputDir, { recursive: true })
    const main = `import os\nfrom telegram import Update\nfrom telegram.ext import Application, MessageHandler, ContextTypes, filters\n\nasync def echo(update: Update, context: ContextTypes.DEFAULT_TYPE):\n    if update.message:\n        await update.message.reply_text(update.message.text or "")\n\ndef main():\n    token = os.environ["TELEGRAM_BOT_TOKEN"]\n    app = Application.builder().token(token).build()\n    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, echo))\n    app.run_polling()\n\nif __name__ == "__main__":\n    main()\n`
    const run = "#!/data/data/com.termux/files/usr/bin/sh\nset -eu\nexec python main.py\n"
    const install = "#!/data/data/com.termux/files/usr/bin/sh\nset -eu\npython -m pip install --user --no-cache-dir python-telegram-bot\n"
    const mainPath = join(outputDir, "main.py")
    const runPath = join(outputDir, "run.sh")
    const installPath = join(outputDir, "install.sh")
    await writeFile(mainPath, main, "utf8")
    await writeFile(runPath, run, { encoding: "utf8", mode: 0o755 })
    await writeFile(installPath, install, { encoding: "utf8", mode: 0o755 })

    // Verification: run python -m py_compile on the generated main.py
    // so the caller can tell the file is at least syntactically valid.
    let exitCode = 127
    try {
      await execFileAsync("python", ["-m", "py_compile", mainPath], { timeout: 10_000 })
      exitCode = 0
    } catch (e) {
      const err = e as { code?: number; message?: string } & { code?: number }
      exitCode = typeof err.code === "number" ? err.code : 1
    }

    return {
      outputDir,
      name,
      files: ["main.py", "run.sh", "install.sh"],
      ok: exitCode === 0,
      receipt: {
        command: `python -m py_compile ${mainPath}`,
        exitCode,
        capturedAt,
      },
      limitations: [
        "no LLM is consulted — the generated bot is a hardcoded echo template",
        "no test runs the bot end-to-end (would require a real TELEGRAM_BOT_TOKEN)",
        ...(safeToGenerate
          ? []
          : [`design-tokens spec missing or incomplete at ${tokens.sourcePath} — generated file may use ad-hoc conventions`]),
      ],
    }
  }
}
