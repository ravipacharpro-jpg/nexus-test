import { expect, test } from "bun:test"
import { desktopNetworkStatus, detectMeteredNetwork, largeDownloadWarning, networkStatusFromWifiInfo } from "./network"

test("uses Termux Wi-Fi state to distinguish Wi-Fi from likely mobile data", async () => {
  expect(networkStatusFromWifiInfo('{"ssid":"NEXUS","ip":"192.168.1.20"}')).toMatchObject({ metered: false })
  expect(networkStatusFromWifiInfo('{}')).toMatchObject({ metered: true })
  await expect(detectMeteredNetwork({ environment: "termux", readWifiInfo: async () => { throw new Error("unavailable") }, interfaceNames: () => [] })).resolves.toMatchObject({ metered: "unknown" })
})

test("warns only for downloads above 100MB when the connection is metered or unknown", async () => {
  expect(desktopNetworkStatus(["en0"])).toMatchObject({ metered: false })
  expect(desktopNetworkStatus(["wwan0"])).toMatchObject({ metered: true })
  await expect(largeDownloadWarning(100 * 1024 * 1024, async () => ({ metered: true, reason: "mobile" }))).resolves.toBeUndefined()
  await expect(largeDownloadWarning(101 * 1024 * 1024, async () => ({ metered: false, reason: "Wi-Fi" }))).resolves.toBeUndefined()
  await expect(largeDownloadWarning(101 * 1024 * 1024, async () => ({ metered: "unknown", reason: "unknown network" }))).resolves.toContain("Confirm before continuing")
})
