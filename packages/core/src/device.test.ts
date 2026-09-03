import { expect, test } from "bun:test"
import { getDeviceConfig, memoryFromProcMeminfo, type DeviceProbe } from "./device"

const GiB = 1024 * 1024 * 1024
const termuxArm64: DeviceProbe = { totalMemoryBytes: 2 * GiB, cpuCores: 4, arch: "aarch64", isTermux: true, env: {} }

test("reports ARM64 and selects a lightweight mobile model for low-resource native Termux", () => {
  expect(getDeviceConfig({}, termuxArm64)).toMatchObject({
    tier: "low",
    isTermux: true,
    isARM64: true,
    preferredModel: "ollama/llama3:8b",
  })
})

test("reads MemTotal safely from Linux procfs data", () => {
  expect(memoryFromProcMeminfo("MemTotal:       2097152 kB\nMemFree:         123456 kB\n")).toBe(2 * GiB)
  expect(memoryFromProcMeminfo("MemFree: 123 kB\n")).toBeUndefined()
})
