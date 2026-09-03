import { detectTaskProfile, isTermuxRuntime } from "@/runtime/task-profile"

describe("task profile device detection", () => {
  test("detects Termux from Android environment markers", () => {
    expect(isTermuxRuntime({ TERMUX_VERSION: "0.118" })).toBe(true)
    expect(isTermuxRuntime({ PREFIX: "/data/data/com.termux/files/usr" })).toBe(true)
  })

  test("uses conservative fast profile on Termux", () => {
    const profile = detectTaskProfile({ env: { TERMUX_VERSION: "0.118" }, memoryBytes: 16 * 1024 ** 3, cpuCount: 12 })
    expect(profile.name).toBe("fast")
    expect(profile.maxParallel).toBe(2)
  })

  test("uses deep profile only for a powerful desktop", () => {
    expect(detectTaskProfile({ env: {}, memoryBytes: 32 * 1024 ** 3, cpuCount: 16 }).name).toBe("deep")
    expect(detectTaskProfile({ env: {}, memoryBytes: 4 * 1024 ** 3, cpuCount: 4 }).name).toBe("balanced")
  })

  test("honors explicit profile override", () => {
    expect(
      detectTaskProfile({ env: { NEXUS_DEVICE_PROFILE: "local" }, memoryBytes: 32 * 1024 ** 3, cpuCount: 16 }).name,
    ).toBe("local")
  })
})
