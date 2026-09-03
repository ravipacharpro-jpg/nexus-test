import { describe, expect, test } from "bun:test"
import { createDeviceReadiness, deviceReadinessAdvice, formatDeviceReadiness } from "../../src/cli/cmd/device"

const termuxGuard = {
  platform: "termux" as const,
  battery: { percentage: 12, status: "DISCHARGING", plugged: "UNPLUGGED" },
  temperatureC: 43,
  network: "possibly-metered" as const,
  level: "conserve" as const,
  warnings: ["Battery is 12%; use a lightweight task profile or connect power."],
}

describe("device readiness", () => {
  test("formats only provided local observations and conservative Termux guidance", () => {
    const readiness = createDeviceReadiness({
      platform: "termux",
      architecture: "arm64",
      cpuCores: 8,
      totalMemoryBytes: 4 * 1024 ** 3,
      freeMemoryBytes: 512 * 1024 ** 2,
      storage: { totalBytes: 64 * 1024 ** 3, availableBytes: 2 * 1024 ** 3 },
      deviceGuard: termuxGuard,
    })
    const output = formatDeviceReadiness(readiness, "table")

    expect(output).toContain("Termux")
    expect(output).toContain("Low free memory observed")
    expect(output).toContain("Low available storage observed")
    expect(output).toContain("Termux guard: Battery is 12%")
    expect(output).toContain("no setup, download, service start")
    expect(output).not.toContain("GPU")
  })

  test("keeps desktop advice conservative when mobile signals are unavailable", () => {
    const readiness = createDeviceReadiness({
      platform: "desktop",
      architecture: "x64",
      cpuCores: 4,
      totalMemoryBytes: 16 * 1024 ** 3,
      freeMemoryBytes: 8 * 1024 ** 3,
      storage: {},
      deviceGuard: { platform: "desktop", network: "unknown", level: "normal", warnings: [] },
    })
    const advice = deviceReadinessAdvice(readiness).join("\n")

    expect(advice).toContain("Available storage could not be observed")
    expect(advice).toContain("does not probe battery, thermal, GPU/VRAM, or network pricing")
    expect(formatDeviceReadiness(readiness, "json")).toContain('"observedOnly": true')
  })
})
