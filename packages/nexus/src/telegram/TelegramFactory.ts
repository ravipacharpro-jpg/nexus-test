import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { spawn, spawnSync } from "node:child_process"
import { join, resolve } from "node:path"
import { TermuxAdapter } from "../termux/TermuxAdapter"

export const BOT_TEMPLATES = [
  "echo",
  "downloader",
  "group-manager",
  "ai-chat",
  "termux-control",
  "file-manager",
  "notes",
  "reminder",
  "url-shortener",
  "weather",
] as const

export type BotTemplate = (typeof BOT_TEMPLATES)[number]

const HUB_ROOT = join(TermuxAdapter.homePath, ".nexus")
const BOT_ROOT = join(HUB_ROOT, "bots")
const TEMPLATE_ROOT = process.env.NEXUS_TEMPLATE_ROOT || join(import.meta.dir, "templates")
declare const NEXUS_EMBEDDED_TEMPLATES: Record<string, Record<string, string>>
const embeddedTemplates: Record<string, Record<string, string>> =
  typeof NEXUS_EMBEDDED_TEMPLATES === "undefined" ? {} : NEXUS_EMBEDDED_TEMPLATES

const GENERIC_MAIN = `import os
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("NEXUS bot is online.")

app = Application.builder().token(os.environ["TELEGRAM_TOKEN"]).build()
app.add_handler(CommandHandler("start", start))
app.run_polling(allowed_updates=Update.ALL_TYPES)
`

const DEFAULT_INSTALL = `#!/data/data/com.termux/files/usr/bin/bash
set -eu
pkg update -y
pkg install -y python
python -m pip install --upgrade --no-cache-dir python-telegram-bot requests
`

function validName(name: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,48}$/.test(name)
}

function readTemplateFile(template: BotTemplate, file: string, fallback: string) {
  const embedded = embeddedTemplates[template]?.[file]
  if (embedded !== undefined) return embedded
  const path = join(TEMPLATE_ROOT, template, file)
  return existsSync(path) ? readFileSync(path, "utf8") : fallback
}

function botPath(name: string) {
  const path = resolve(BOT_ROOT, name)
  if (path !== join(BOT_ROOT, name)) throw new Error("Invalid bot path.")
  return path
}

export class TelegramFactory {
  static root() {
    return BOT_ROOT
  }

  static listTemplates(): readonly BotTemplate[] {
    return BOT_TEMPLATES
  }

  static createBot(name: string, type: BotTemplate = "echo") {
    if (!validName(name)) throw new Error("Bot name must use 1-49 letters, numbers, hyphens, or underscores.")
    if (!BOT_TEMPLATES.includes(type)) throw new Error(`Unknown template: ${type}`)

    const directory = botPath(name)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, "main.py"), readTemplateFile(type, "main.py", GENERIC_MAIN))
    writeFileSync(join(directory, "install.sh"), readTemplateFile(type, "install.sh", DEFAULT_INSTALL), { mode: 0o755 })
    writeFileSync(
      join(directory, ".env"),
      "# Set these values locally; never commit this file.\nTELEGRAM_TOKEN=replace_with_your_botfather_token\nTELEGRAM_ALLOWED_USER_IDS=\nTELEGRAM_ALLOWED_CHAT_IDS=\n",
    )
    writeFileSync(
      join(directory, "run.sh"),
      `#!/data/data/com.termux/files/usr/bin/bash\nset -eu\ncd "$(dirname "$0")"\nset -a\n. ./.env\nset +a\nexec python ./main.py\n`,
      { mode: 0o755 },
    )
    writeFileSync(
      join(directory, "README.md"),
      `# ${name}\n\nTemplate: ${type}\n\n1. Edit .env and set TELEGRAM_TOKEN locally.\n2. Run ./install.sh.\n3. Run ./run.sh.\n`,
    )
    return directory
  }

  static deployBot(name: string) {
    if (!validName(name)) throw new Error("Invalid bot name.")
    const directory = botPath(name)
    if (!existsSync(join(directory, "run.sh"))) throw new Error(`Bot not found: ${name}`)

    const serviceDirectory = join(HUB_ROOT, "services", name)
    mkdirSync(serviceDirectory, { recursive: true })
    const watchdog = join(serviceDirectory, "watchdog.sh")
    writeFileSync(
      watchdog,
      `#!/data/data/com.termux/files/usr/bin/bash\nset -eu\ncd ${JSON.stringify(directory)}\nwhile true; do\n  ./run.sh\n  sleep 5\ndone\n`,
      { mode: 0o755 },
    )

    const pidFile = join(serviceDirectory, "pid")
    const existingPid = existsSync(pidFile) ? readFileSync(pidFile, "utf8").trim() : ""
    if (existingPid && spawnSync("kill", ["-0", existingPid]).status === 0) return serviceDirectory

    const child = spawn("bash", [watchdog], { detached: true, stdio: "ignore" })
    child.unref()
    if (!child.pid) throw new Error("Unable to start bot watchdog.")
    writeFileSync(pidFile, String(child.pid))
    return serviceDirectory
  }

  static status() {
    mkdirSync(BOT_ROOT, { recursive: true })
    return readdirSync(BOT_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const pidFile = join(HUB_ROOT, "services", entry.name, "pid")
        const pid = existsSync(pidFile) ? readFileSync(pidFile, "utf8").trim() : ""
        return { name: entry.name, pid, running: Boolean(pid) && spawnSync("kill", ["-0", pid]).status === 0 }
      })
  }
}

export function botTemplatePath(name: BotTemplate) {
  return join(TEMPLATE_ROOT, name)
}

export function ensureTemplateAssets() {
  mkdirSync(TEMPLATE_ROOT, { recursive: true })
  for (const template of BOT_TEMPLATES) mkdirSync(join(TEMPLATE_ROOT, template), { recursive: true })
}

export { HUB_ROOT }
