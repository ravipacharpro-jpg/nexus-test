import { execFile } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir, platform } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { getFreelancer, type Freelancer } from "./FreelancerDB"

const execFileAsync = promisify(execFile)
const STATE_FILE = join(homedir(), ".nexus", "freelancers", "installed.json")
const STORAGE_BUFFER_MB = 50
const LOW_STORAGE_MB = 100

export type HireResult = {
  name: string
  success: boolean
  alreadyThere?: boolean
  sizeMB: number
  time?: number
  error?: string
}

async function runShell(command: string, timeout = 120_000, stdio: "inherit" | "ignore" = "ignore") {
  const result = await execFileAsync("sh", ["-lc", command], { timeout, maxBuffer: 1024 * 1024 })
  if (stdio === "inherit") {
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
  }
  return result
}

export class HireStaff {
  async hire(freelancerName: string): Promise<HireResult> {
    const worker = getFreelancer(freelancerName)
    if (!worker) throw new Error(`Freelancer ${freelancerName} not found`)

    if (await this.isInstalled(worker)) {
      console.log(`✅ ${freelancerName} already on payroll`)
      return { name: freelancerName, success: true, alreadyThere: true, sizeMB: worker.sizeMB }
    }

    const freeSpace = await this.getFreeSpaceMB()
    if (freeSpace !== undefined && freeSpace < worker.sizeMB + STORAGE_BUFFER_MB) {
      console.log("⚠️ Low storage! Cleaning cache first...")
      await this.cleanCache()
    }

    if (process.env.NEXUS_BUSINESSMAN_DRY_RUN === "1") {
      console.log(`🤝 Hiring: ${freelancerName} (+${worker.sizeMB}MB)... [dry run]`)
      await this.recordInstalled(worker)
      return { name: freelancerName, success: true, sizeMB: worker.sizeMB, time: 0 }
    }

    console.log(`🤝 Hiring: ${freelancerName} (+${worker.sizeMB}MB)...`)
    const start = Date.now()
    try {
      await runShell(worker.installCmd, 120_000, "inherit")
      const time = Date.now() - start
      await this.recordInstalled(worker)
      console.log(`✅ Hired in ${time}ms`)
      return { name: freelancerName, success: true, sizeMB: worker.sizeMB, time }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.log(`❌ Hiring failed: ${message}`)
      return { name: freelancerName, success: false, sizeMB: worker.sizeMB, error: message }
    }
  }

  async isInstalled(worker: Freelancer): Promise<boolean> {
    try {
      await runShell(worker.checkCmd, 15_000)
      return true
    } catch {
      return false
    }
  }

  async getFreeSpaceMB(): Promise<number | undefined> {
    try {
      const path = platform() === "android" ? "/data" : homedir()
      const { stdout } = await execFileAsync("df", ["-Pm", path], { timeout: 5_000 })
      const lines = stdout.trim().split(/\r?\n/)
      const fields = lines.at(-1)?.trim().split(/\s+/)
      const available = Number(fields?.[3])
      return Number.isFinite(available) ? available : undefined
    } catch {
      return undefined
    }
  }

  async cleanCache(): Promise<void> {
    if (process.env.NEXUS_BUSINESSMAN_DRY_RUN === "1") {
      console.log("🧹 Cache cleaned... ✅ [dry run]")
      return
    }
    const commands = [
      "python -m pip cache purge",
      "command -v pkg >/dev/null 2>&1 && pkg clean -y || true",
      "find \"${TMPDIR:-/tmp}\" -maxdepth 1 -type d -name 'pip-*' -exec rm -rf -- {} + 2>/dev/null || true",
    ]
    for (const command of commands) {
      try {
        await runShell(command, 30_000)
      } catch {
        // Cache tools are optional; cleanup remains best effort.
      }
    }
  }

  async recordInstalled(worker: Freelancer): Promise<void> {
    const current = await this.readInstalled()
    current[worker.name] = { sizeMB: worker.sizeMB, installedAt: new Date().toISOString() }
    await mkdir(dirname(STATE_FILE), { recursive: true })
    await writeFile(STATE_FILE, JSON.stringify(current, null, 2) + "\n", "utf8")
  }

  async removeInstalled(name: string): Promise<void> {
    const current = await this.readInstalled()
    delete current[name]
    await mkdir(dirname(STATE_FILE), { recursive: true })
    await writeFile(STATE_FILE, JSON.stringify(current, null, 2) + "\n", "utf8")
  }

  async readInstalled(): Promise<Record<string, { sizeMB: number; installedAt: string }>> {
    try {
      return JSON.parse(await readFile(STATE_FILE, "utf8")) as Record<string, { sizeMB: number; installedAt: string }>
    } catch {
      return {}
    }
  }
}

export { STATE_FILE }
