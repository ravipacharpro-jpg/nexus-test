import os from "node:os"
import fs from "node:fs"
import { isNativeTermux } from "./platform"

export type DeviceTier = "low" | "medium" | "high"

export type DeviceResourceConfig = {
  tier: DeviceTier
  totalRamGB: number
  cpuCores: number
  isTermux: boolean
  isARM64: boolean
  maxConcurrency: number
  maxConcurrentTools: number
  maxToolOutputBytes: number
  maxToolOutputLines: number
  disableBackgroundAgents: boolean
  disableWatcher: boolean
  compactContext: boolean
  preferredModel?: string
}

type ResourceLimits = Omit<DeviceResourceConfig, "tier" | "totalRamGB" | "cpuCores" | "isTermux" | "isARM64">

export type DeviceProbe = {
  totalMemoryBytes: number
  cpuCores: number
  arch: string
  isTermux: boolean
  env: Record<string, string | undefined>
}

const LIMITS: Record<DeviceTier, ResourceLimits> = {
  low: {
    maxConcurrency: 1,
    maxConcurrentTools: 1,
    maxToolOutputBytes: 8 * 1024,
    maxToolOutputLines: 600,
    disableBackgroundAgents: true,
    disableWatcher: true,
    compactContext: true,
    preferredModel: "ollama/phi3",
  },
  medium: {
    maxConcurrency: 2,
    maxConcurrentTools: 2,
    maxToolOutputBytes: 50 * 1024,
    maxToolOutputLines: 2_000,
    disableBackgroundAgents: false,
    disableWatcher: false,
    compactContext: true,
    preferredModel: "groq/openai/gpt-oss-120b",
  },
  high: {
    maxConcurrency: 4,
    maxConcurrentTools: 4,
    maxToolOutputBytes: 200 * 1024,
    maxToolOutputLines: 10_000,
    disableBackgroundAgents: false,
    disableWatcher: false,
    compactContext: false,
  },
}

const isTermuxEnvironment = () => isNativeTermux()

export const memoryFromProcMeminfo = (contents: string) => {
  const kibibytes = contents.match(/^MemTotal:\s+(\d+)\s+kB$/m)?.[1]
  return kibibytes ? Number(kibibytes) * 1024 : undefined
}

const systemDeviceProbe = (): DeviceProbe => {
  const isTermux = isTermuxEnvironment()
  let totalMemoryBytes = os.totalmem()
  if (isTermux) {
    try {
      totalMemoryBytes = memoryFromProcMeminfo(fs.readFileSync("/proc/meminfo", "utf8")) ?? totalMemoryBytes
    } catch {
      // /proc may be unavailable in constrained Android environments; keep the Node fallback.
    }
  }
  return { totalMemoryBytes, cpuCores: os.cpus()?.length || 2, arch: process.arch, isTermux, env: process.env }
}

const isArm64Architecture = (arch: string) => ["arm64", "aarch64"].includes(arch.toLowerCase())

export const detectDeviceTier = (probe: DeviceProbe = systemDeviceProbe()): DeviceTier => {
  const totalRAMGB = probe.totalMemoryBytes / 1024 / 1024 / 1024
  const cores = probe.cpuCores
  const termux = probe.isTermux

  if ((termux && totalRAMGB < 4) || totalRAMGB < 2) return "low"
  if (totalRAMGB < 8 || cores < 4) return "medium"
  return "high"
}

export const applyResourceLimits = (tier: DeviceTier): ResourceLimits => ({ ...LIMITS[tier] })

const positiveInteger = (value: string | undefined) => {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

const validTier = (value: string | undefined): DeviceTier | undefined =>
  value === "low" || value === "medium" || value === "high" ? value : undefined

export const getDeviceConfig = (overrides: { maxConcurrentTools?: number } = {}, probe: DeviceProbe = systemDeviceProbe()): DeviceResourceConfig => {
  const totalRamGB = probe.totalMemoryBytes / 1024 / 1024 / 1024
  const cpuCores = probe.cpuCores
  const isTermux = probe.isTermux
  const isARM64 = isArm64Architecture(probe.arch)
  const tier = validTier(probe.env.NEXUS_DEVICE_TIER) ?? detectDeviceTier(probe)
  const base = applyResourceLimits(tier)
  const maxConcurrency = positiveInteger(probe.env.NEXUS_MAX_CONCURRENCY) ?? base.maxConcurrency
  const maxConcurrentTools =
    positiveInteger(probe.env.NEXUS_MAX_CONCURRENT_TOOLS) ?? overrides.maxConcurrentTools ?? base.maxConcurrentTools
  const maxToolOutputBytes = positiveInteger(probe.env.NEXUS_MAX_TOOL_OUTPUT_BYTES) ?? base.maxToolOutputBytes
  const maxToolOutputLines = positiveInteger(probe.env.NEXUS_MAX_TOOL_OUTPUT_LINES) ?? base.maxToolOutputLines
  const compactContext = probe.env.NEXUS_DISABLE_AUTOCOMPACT === "0" ? false : base.compactContext

  return {
    tier,
    totalRamGB,
    cpuCores,
    isTermux,
    isARM64,
    maxConcurrency,
    maxConcurrentTools,
    maxToolOutputBytes,
    maxToolOutputLines,
    disableBackgroundAgents: probe.env.NEXUS_DISABLE_BACKGROUND_AGENTS === "1" || base.disableBackgroundAgents,
    disableWatcher: probe.env.NEXUS_DISABLE_WATCHER === "1" || base.disableWatcher,
    compactContext,
    preferredModel: probe.env.NEXUS_DEFAULT_MODEL?.trim() || (isTermux && isARM64 && (tier === "low" || tier === "medium") ? "ollama/llama3:8b" : base.preferredModel),
  }
}

export const deviceSummary = (config: DeviceResourceConfig = getDeviceConfig()) => {
  const tier = config.tier.toUpperCase()
  const mode = config.tier === "low" ? "Lightweight" : config.tier === "medium" ? "Balanced" : "Full"
  return `Device: ${tier} (${config.totalRamGB.toFixed(1)}GB RAM, ${config.isTermux ? `Termux${config.isARM64 ? "/ARM64" : ""}` : `${config.cpuCores} cores`})\nMode: ${mode} (${config.maxConcurrentTools} concurrent tools, ${Math.round(config.maxToolOutputBytes / 1024)}KB output cap${config.preferredModel ? `, ${config.preferredModel} preferred` : ""})`
}
