import { describe, expect, test } from "bun:test"
import type { DeviceResourceConfig } from "@nexus-ai/core/device"
import {
  formatLocalModelCatalog,
  formatLocalModelDetail,
  formatLocalModelRecommendations,
  localModelHardwareProfile,
  localModelRecommendations,
  recommendedLocalModels,
} from "../../src/cli/cmd/local-models"

function device(overrides: Partial<DeviceResourceConfig> = {}): DeviceResourceConfig {
  return {
    tier: "medium",
    totalRamGB: 8,
    cpuCores: 8,
    isTermux: false,
    isARM64: false,
    maxConcurrency: 2,
    maxConcurrentTools: 2,
    maxToolOutputBytes: 50_000,
    maxToolOutputLines: 2_000,
    disableBackgroundAgents: false,
    disableWatcher: false,
    compactContext: true,
    ...overrides,
  }
}

describe("local model recommendations", () => {
  test("reports only observed hardware facts and never invents a GPU", () => {
    expect(localModelHardwareProfile(device({ isTermux: true, isARM64: true }))).toMatchObject({
      platform: "Termux",
      architecture: "ARM64",
      gpu: "not detected",
    })
  })

  test("filters catalog conservatively by RAM and keeps output no-download", () => {
    expect(recommendedLocalModels(device({ totalRamGB: 4 })).every((model) => model.minimumRamGB <= 2.8)).toBe(true)
    const output = formatLocalModelRecommendations(device({ totalRamGB: 4, isTermux: true, isARM64: true })).join("\n")
    expect(output).toContain("No download was started.")
    expect(output).toContain("GPU/VRAM: not detected")
    expect(output).toContain("Termux:")
  })

  test("explains recommendation rationale for every catalog model without assuming a GPU", () => {
    const recommendations = localModelRecommendations(device({ totalRamGB: 8 }))
    expect(recommendations.find((item) => item.model.id === "qwen2.5-coder:7b-instruct-q4")).toMatchObject({
      recommended: false,
      conservativeRamAllowanceGB: 5.6,
    })
    expect(
      recommendations.find((item) => item.model.id === "qwen2.5-coder:7b-instruct-q4")?.rationale,
    ).toContain("needs >=8GB RAM")
  })

  test("formats structured catalog and exact detail as informational-only output", () => {
    const config = device({ totalRamGB: 16, isTermux: true, isARM64: true })
    const catalog = JSON.parse(formatLocalModelCatalog(config, "json"))
    const detail = JSON.parse(formatLocalModelDetail(config, "qwen2.5-coder:7b-instruct-q4", "json"))

    expect(catalog.downloadsStarted).toBe(false)
    expect(catalog.backend).toContain("no GPU acceleration is assumed")
    expect(catalog.models).toHaveLength(5)
    expect(detail.model.id).toBe("qwen2.5-coder:7b-instruct-q4")
    expect(detail.runtimeStarted).toBe(false)
    expect(detail.hardware.platform).toBe("Termux")
  })

  test("does not fabricate an unknown model detail or trigger any download", () => {
    const output = formatLocalModelDetail(device(), "unknown-model")
    expect(output).toContain("Unknown local catalog model")
    expect(output).toContain("No download or local-model runtime was started.")
  })
})
