import { existsSync, readdirSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

export type DeviceGuardLevel = "normal" | "conserve" | "blocked"

export type DeviceGuardSnapshot = {
  platform: "termux" | "desktop"
  battery?: { percentage?: number; status?: string; plugged?: string }
  temperatureC?: number
  network: "unknown" | "wifi" | "possibly-metered"
  level: DeviceGuardLevel
  warnings: string[]
}

function isTermux() {
  return Boolean(process.env.TERMUX_VERSION || process.env.PREFIX?.includes("com.termux"))
}

function commandJson(command: string) {
  try {
    const output = spawnSync(command, { encoding: "utf8", timeout: 4_000 })
    if (output.status !== 0 || !output.stdout.trim()) return undefined
    return JSON.parse(output.stdout) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function battery() {
  const value = commandJson("termux-battery-status")
  if (!value) return undefined
  return {
    percentage: typeof value.percentage === "number" ? value.percentage : undefined,
    status: typeof value.status === "string" ? value.status : undefined,
    plugged: typeof value.plugged === "string" ? value.plugged : undefined,
  }
}

function temperatureC() {
  if (!existsSync("/sys/class/thermal")) return undefined
  const values: number[] = []
  try {
    for (const entry of readdirSync("/sys/class/thermal")) {
      if (!entry.startsWith("thermal_zone")) continue
      const raw = Number(readFileSync(`/sys/class/thermal/${entry}/temp`, "utf8").trim())
      if (!Number.isFinite(raw)) continue
      const celsius = raw > 1_000 ? raw / 1_000 : raw
      if (celsius > 0 && celsius < 120) values.push(celsius)
    }
  } catch {}
  return values.length > 0 ? Math.max(...values) : undefined
}

function network() {
  const value = commandJson("termux-wifi-connectioninfo")
  if (!value) return "unknown" as const
  return typeof value.ssid === "string" && value.ssid.trim() ? "wifi" as const : "possibly-metered" as const
}

export function inspectDeviceGuard(): DeviceGuardSnapshot {
  if (!isTermux()) return { platform: "desktop", network: "unknown", level: "normal", warnings: [] }
  const currentBattery = battery()
  const temperature = temperatureC()
  const currentNetwork = network()
  const warnings: string[] = []
  let level: DeviceGuardLevel = "normal"
  const charging = currentBattery?.status?.toUpperCase() === "CHARGING" || currentBattery?.plugged?.toUpperCase() === "AC"
  if (currentBattery?.percentage !== undefined && currentBattery.percentage <= 10 && !charging) {
    warnings.push(`Battery is ${currentBattery.percentage}%; avoid long or high-power tasks until charging.`)
    level = "blocked"
  } else if (currentBattery?.percentage !== undefined && currentBattery.percentage <= 25 && !charging) {
    warnings.push(`Battery is ${currentBattery.percentage}%; use a lightweight task profile or connect power.`)
    level = "conserve"
  }
  if (temperature !== undefined && temperature >= 48) {
    warnings.push(`Device temperature is ${temperature.toFixed(1)}°C; pause high-power work and allow cooling.`)
    level = "blocked"
  } else if (temperature !== undefined && temperature >= 42) {
    warnings.push(`Device temperature is ${temperature.toFixed(1)}°C; use a lightweight profile.`)
    if (level === "normal") level = "conserve"
  }
  if (currentNetwork === "possibly-metered") warnings.push("Network may be metered; NEXUS will not start large model downloads without explicit confirmation.")
  return { platform: "termux", battery: currentBattery, temperatureC: temperature, network: currentNetwork, level, warnings }
}
