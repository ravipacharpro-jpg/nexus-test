import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const START = "# >>> NEXUS Termux keyboard setup >>>"
const END = "# <<< NEXUS Termux keyboard setup <<<"

export type TermuxSetupOptions = {
  homeDir?: string
  isTermux?: boolean
}

export type TermuxSetupResult = {
  configured: boolean
  propertiesPath?: string
  backupPath?: string
  message: string
}

export function isTermuxRuntime(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.TERMUX_VERSION || env.PREFIX?.includes("com.termux"))
}

function managedBlock() {
  return `${START}
# Keyboard toggle, terminal navigation, and clipboard paste controls for NEXUS.
# PASTE is a supported Termux special key. Copy remains available through
# Termux's text-selection menu, avoiding an unsafe Ctrl+C remapping.
extra-keys = [['ESC','/','-','HOME','UP','END','PGUP'], \\
              ['TAB','CTRL','ALT','LEFT','DOWN','RIGHT','PGDN'], \\
              ['KEYBOARD','PASTE','F1','F2','F3','F4']]
extra-keys-style = default
soft-keyboard-toggle-behaviour = enable/disable
use-black-ui = true
terminal-cursor-style = block
terminal-cursor-blink-rate = 500
${END}`
}

function replaceManagedBlock(existing: string) {
  const pattern = new RegExp(`${START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "m")
  return pattern.test(existing)
    ? existing.replace(pattern, `${managedBlock()}\n`)
    : `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${managedBlock()}\n`
}

export async function setupTermuxKeyboard(options: TermuxSetupOptions = {}): Promise<TermuxSetupResult> {
  if (!(options.isTermux ?? isTermuxRuntime())) {
    return { configured: false, message: "⚠️ This command only runs on Termux." }
  }

  const propertiesPath = join(options.homeDir ?? homedir(), ".termux", "termux.properties")
  const directory = join(propertiesPath, "..")
  await mkdir(directory, { recursive: true })

  let existing = ""
  let backupPath: string | undefined
  try {
    await access(propertiesPath)
    existing = await readFile(propertiesPath, "utf8")
    backupPath = `${propertiesPath}.backup`
    try {
      // Keep the first backup intact so re-runs never replace the user's
      // original configuration with an already-managed file.
      await access(backupPath)
    } catch {
      await copyFile(propertiesPath, backupPath)
    }
  } catch {
    // A new properties file needs no backup.
  }

  await writeFile(propertiesPath, replaceManagedBlock(existing), "utf8")
  const backupLine = backupPath ? `\nBackup: ${backupPath}` : ""
  return {
    configured: true,
    propertiesPath,
    backupPath,
    message: [
      "✅ Termux configured!",
      `File: ${propertiesPath}${backupLine}`,
      "Buttons added: KEYBOARD, PASTE, navigation, Ctrl/Alt, and function keys.",
      "Restart Termux to apply, or run: termux-reload-settings",
    ].join("\n"),
  }
}
