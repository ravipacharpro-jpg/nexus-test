import { execFile } from "node:child_process"
import os from "node:os"
import { promisify } from "node:util"
import { detectRuntimeEnvironment, type RuntimeEnvironment } from "./platform"

const execFileAsync = promisify(execFile)
export type NetworkStatus = { metered: boolean | "unknown"; reason: string }
export type NetworkProbe = {
  environment: RuntimeEnvironment
  readWifiInfo: () => Promise<string>
  interfaceNames: () => string[]
}

const systemNetworkProbe = (): NetworkProbe => ({
  environment: detectRuntimeEnvironment(),
  readWifiInfo: async () => (await execFileAsync("termux-wifi-connectioninfo", [], { timeout: 10_000 })).stdout,
  interfaceNames: () => Object.keys(os.networkInterfaces()),
})

const nonEmptyString = (value: unknown) => typeof value === "string" && value.trim().length > 0

export const networkStatusFromWifiInfo = (stdout: string): NetworkStatus => {
  const data = JSON.parse(stdout) as { ip?: unknown; ssid?: unknown }
  return nonEmptyString(data.ip) || (nonEmptyString(data.ssid) && data.ssid !== "<unknown ssid>")
    ? { metered: false, reason: "connected through Wi-Fi" }
    : { metered: true, reason: "Wi-Fi is not connected; mobile data may be in use" }
}

export const desktopNetworkStatus = (interfaceNames: string[]): NetworkStatus =>
  /usb|mobile|tether|wwan/.test(interfaceNames.join(" ").toLowerCase())
    ? { metered: true, reason: "a tethered or mobile interface was detected" }
    : { metered: false, reason: "no tethered or mobile interface was detected" }

export const detectMeteredNetwork = async (probe: NetworkProbe = systemNetworkProbe()): Promise<NetworkStatus> => {
  if (probe.environment === "termux") {
    try {
      return networkStatusFromWifiInfo(await probe.readWifiInfo())
    } catch { return { metered: "unknown", reason: "Wi-Fi state is unavailable; confirm before a large download" } }
  }
  return desktopNetworkStatus(probe.interfaceNames())
}

export const largeDownloadWarning = async (bytes: number, readNetwork: () => Promise<NetworkStatus> = detectMeteredNetwork) => {
  const network = await readNetwork()
  return bytes > 100 * 1024 * 1024 && network.metered !== false
    ? `Large download (${Math.ceil(bytes / 1024 / 1024)}MB): ${network.reason}. Confirm before continuing.`
    : undefined
}
