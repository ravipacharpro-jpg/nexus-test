import path from "node:path"
import fs from "node:fs"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const isTermux = () => Boolean(process.env.TERMUX_VERSION || process.env.PREFIX?.includes("com.termux"))

export class ServiceManager {
  private async run(command: string, args: string[] = []) {
    if (!isTermux()) throw new Error(`${command} is available only in native Termux.`)
    try { await execFileAsync(command, args, { timeout: 10_000 }) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`${command} is unavailable. Install and open Termux:API first: pkg install termux-api`)
      throw error
    }
  }

  acquireWakeLock = () => this.run("termux-wake-lock")
  releaseWakeLock = () => this.run("termux-wake-unlock")
  notify = (title: string, content: string) => this.run("termux-notification", ["--title", title, "--content", content])
  toast = (message: string) => this.run("termux-toast", [message])

  enableBootStart(command = "nexus serve") {
    if (!isTermux()) throw new Error("Termux:Boot setup is available only in native Termux.")
    const bootDir = path.join(process.env.HOME ?? "", ".termux", "boot")
    const script = path.join(bootDir, "nexus.sh")
    fs.mkdirSync(bootDir, { recursive: true })
    fs.writeFileSync(script, `#!/data/data/com.termux/files/usr/bin/sh\n# Requires the Termux:Boot Android app.\n# A wake lock is best effort only; Android battery policy can still stop this process.\nif command -v termux-wake-lock >/dev/null 2>&1; then\n  termux-wake-lock || true\nfi\nexec ${command}\n`, { mode: 0o700 })
    return { path: script, message: "Install and open Termux:Boot once, then Android may start this script after boot. The wake lock is best effort; battery optimization can still stop processes." }
  }
}
