import { inspectDeviceGuard } from "./DeviceGuard"

export type RuntimeGuardReading = { batteryPercent?: number; charging?: boolean; temperatureC?: number }

export type RuntimeGuardVerdict = { ok: true } | { ok: false; reason: string }

export type RuntimeGuardProbe = () => RuntimeGuardReading | Promise<RuntimeGuardReading>

export const RUNTIME_GUARD_MIN_BATTERY_PERCENT = 15
export const RUNTIME_GUARD_CRITICAL_TEMPERATURE_C = 48

let probeFailureLogged = false

// A failed sensor read must never block work, so probe errors degrade to "ok" with a single warning.
export async function runtimeGuard(probe: RuntimeGuardProbe = defaultProbe): Promise<RuntimeGuardVerdict> {
  let reading: RuntimeGuardReading
  try {
    reading = await probe()
  } catch (error) {
    if (!probeFailureLogged) {
      probeFailureLogged = true
      console.warn(`⚠️ Battery/thermal probe failed (${error instanceof Error ? error.message : String(error)}); assuming the device is healthy.`)
    }
    return { ok: true }
  }
  if (reading.batteryPercent !== undefined && !reading.charging && reading.batteryPercent < RUNTIME_GUARD_MIN_BATTERY_PERCENT)
    return { ok: false, reason: `battery is at ${reading.batteryPercent}% (below ${RUNTIME_GUARD_MIN_BATTERY_PERCENT}%) and not charging; connect power and resume the task` }
  if (reading.temperatureC !== undefined && reading.temperatureC >= RUNTIME_GUARD_CRITICAL_TEMPERATURE_C)
    return { ok: false, reason: `device temperature ${reading.temperatureC.toFixed(1)}°C is critical; let the device cool down and resume the task` }
  return { ok: true }
}

function defaultProbe(): RuntimeGuardReading {
  const snapshot = inspectDeviceGuard()
  const status = snapshot.battery?.status?.toUpperCase()
  const plugged = snapshot.battery?.plugged?.toUpperCase()
  return {
    batteryPercent: snapshot.battery?.percentage,
    // FULL counts as charging so a just-unplugged full battery does not trip the rule.
    charging: status === "CHARGING" || status === "FULL" || plugged === "AC" || plugged === "USB",
    temperatureC: snapshot.temperatureC,
  }
}
