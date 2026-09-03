import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { getFreelancer } from "./FreelancerDB"
import { HireStaff, type HireResult } from "./HireStaff"

const execFileAsync = promisify(execFile)

export type FireResult = {
  name: string
  success: boolean
  savedMB: number
  error?: string
}

export class FireStaff {
  constructor(private readonly hireStaff = new HireStaff()) {}

  async fire(freelancerName: string): Promise<FireResult> {
    const worker = getFreelancer(freelancerName)
    if (!worker) return { name: freelancerName, success: true, savedMB: 0 }

    console.log(`🔥 Firing: ${freelancerName}...`)
    let success = true
    let error: string | undefined
    try {
      if (process.env.NEXUS_BUSINESSMAN_DRY_RUN !== "1") {
        await execFileAsync("sh", ["-lc", worker.uninstallCmd], { timeout: 120_000, maxBuffer: 1024 * 1024 })
      }
    } catch (cause) {
      // Uninstall is intentionally idempotent: a missing package is not a job failure.
      error = cause instanceof Error ? cause.message : String(cause)
      success = true
    } finally {
      await this.hireStaff.removeInstalled(freelancerName)
      await this.hireStaff.cleanCache()
    }

    console.log(`✅ Fired ${freelancerName}. Saved ${worker.sizeMB}MB.`)
    return { name: freelancerName, success, savedMB: worker.sizeMB, error }
  }

  async fireMany(workers: Array<{ name: string } | HireResult>): Promise<number> {
    let savedMB = 0
    for (const worker of workers) {
      const result = await this.fire(worker.name)
      savedMB += result.savedMB
    }
    return savedMB
  }
}
