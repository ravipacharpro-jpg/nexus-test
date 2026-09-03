import { execFile } from "node:child_process"
import fs from "node:fs"
import { promisify } from "node:util"
import { detectRuntimeEnvironment } from "./platform"

const execFileAsync = promisify(execFile)
const GiB = 1024 * 1024 * 1024

export type PowerStatus = { batteryPercent?: number; temperatureC?: number; source: "termux" | "sysfs" | "unavailable" }
export type WorkloadPolicy = { throttled: boolean; maxConcurrency?: number; disableBackgroundAgents: boolean; preferredModel?: string; reason?: string }

const numberFrom = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined

export const readPowerStatus = async (): Promise<PowerStatus> => {
  if (detectRuntimeEnvironment() === "termux") {
    try {
      const { stdout } = await execFileAsync("termux-battery-status", [], { timeout: 10_000 })
      const data = JSON.parse(stdout) as { percentage?: unknown; temperature?: unknown }
      return { batteryPercent: numberFrom(data.percentage), temperatureC: numberFrom(data.temperature), source: "termux" }
    } catch { return { source: "unavailable" } }
  }
  try {
    const battery = fs.readdirSync("/sys/class/power_supply").find((entry) => /^BAT/i.test(entry))
    const percent = battery ? Number(fs.readFileSync(`/sys/class/power_supply/${battery}/capacity`, "utf8").trim()) : undefined
    const zones = fs.readdirSync("/sys/class/thermal").filter((entry) => entry.startsWith("thermal_zone"))
    const readings = zones.map((zone) => Number(fs.readFileSync(`/sys/class/thermal/${zone}/temp`, "utf8").trim()) / 1000).filter(Number.isFinite)
    return { batteryPercent: numberFrom(percent), temperatureC: readings.length ? Math.max(...readings) : undefined, source: "sysfs" }
  } catch { return { source: "unavailable" } }
}

export const workloadPolicy = (power: PowerStatus): WorkloadPolicy => {
  if ((power.batteryPercent !== undefined && power.batteryPercent < 20) || (power.temperatureC !== undefined && power.temperatureC > 45)) {
    const reason = power.batteryPercent !== undefined && power.batteryPercent < 20 ? "battery below 20%" : "temperature above 45°C"
    return { throttled: true, maxConcurrency: 1, disableBackgroundAgents: true, preferredModel: "llama3:8b", reason }
  }
  return { throttled: false, disableBackgroundAgents: false }
}

export const arm64RecommendedModel = () => process.arch === "arm64" && detectRuntimeEnvironment() === "termux" ? "llama3:8b" : undefined
