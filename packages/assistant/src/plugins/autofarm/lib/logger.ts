// Simple logger for the autofarm plugin.
// Writes to ~/.nexus/autofarm.log and prints colored lines to the console.
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

const LOG_DIR = path.join(os.homedir(), ".nexus")
const LOG_FILE = path.join(LOG_DIR, "autofarm.log")

try {
  fs.mkdirSync(LOG_DIR, { recursive: true })
} catch {}

function ts(): string {
  return new Date().toISOString()
}

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
}

function write(level: "INFO" | "WARN" | "ERROR" | "OK" | "DEBUG", scope: string, msg: string) {
  const line = `[${ts()}] [${level}] [${scope}] ${msg}`
  try {
    fs.appendFileSync(LOG_FILE, line + "\n")
  } catch {}
  const color =
    level === "ERROR" ? COLORS.red :
    level === "WARN"  ? COLORS.yellow :
    level === "OK"    ? COLORS.green :
    level === "DEBUG" ? COLORS.dim : COLORS.cyan
  const tag = `${color}[${level}]${COLORS.reset}`
  process.stdout.write(`${COLORS.dim}${ts()}${COLORS.reset} ${tag} ${COLORS.magenta}${scope}${COLORS.reset} ${msg}\n`)
}

export const log = {
  info: (scope: string, msg: string) => write("INFO", scope, msg),
  warn: (scope: string, msg: string) => write("WARN", scope, msg),
  error: (scope: string, msg: string) => write("ERROR", scope, msg),
  ok: (scope: string, msg: string) => write("OK", scope, msg),
  debug: (scope: string, msg: string) => {
    if (process.env.NEXUS_AUTOFARM_DEBUG === "1") write("DEBUG", scope, msg)
  },
}

export function logFile(): string {
  return LOG_FILE
}