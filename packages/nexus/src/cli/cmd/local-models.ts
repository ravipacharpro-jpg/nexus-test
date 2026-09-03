import type { DeviceResourceConfig } from "@nexus-ai/core/device"

export type LocalModelCatalogEntry = {
  id: string
  label: string
  quantization: string
  downloadGB: number
  storageGB: number
  minimumRamGB: number
  contextTokens: number
  likelySpeed: "compact" | "moderate" | "heavy"
}

export type LocalModelHardwareProfile = {
  ramGB: number
  cpuCores: number
  tier: DeviceResourceConfig["tier"]
  platform: "Termux" | "PC"
  architecture: string
  gpu: "not detected"
}

export type LocalModelRecommendation = {
  model: LocalModelCatalogEntry
  recommended: boolean
  conservativeRamAllowanceGB: number
  rationale: string
}

export const LOCAL_MODEL_CATALOG: readonly LocalModelCatalogEntry[] = [
  {
    id: "qwen2.5-coder:3b-instruct-q4",
    label: "Qwen 2.5 Coder 3B",
    quantization: "Q4",
    downloadGB: 2.1,
    storageGB: 2.5,
    minimumRamGB: 4,
    contextTokens: 32_000,
    likelySpeed: "compact",
  },
  {
    id: "llama3.2:3b-instruct-q4",
    label: "Llama 3.2 3B",
    quantization: "Q4",
    downloadGB: 2,
    storageGB: 2.4,
    minimumRamGB: 4,
    contextTokens: 128_000,
    likelySpeed: "compact",
  },
  {
    id: "qwen2.5-coder:7b-instruct-q4",
    label: "Qwen 2.5 Coder 7B",
    quantization: "Q4",
    downloadGB: 4.7,
    storageGB: 5.4,
    minimumRamGB: 8,
    contextTokens: 32_000,
    likelySpeed: "moderate",
  },
  {
    id: "llama3.1:8b-instruct-q4",
    label: "Llama 3.1 8B",
    quantization: "Q4",
    downloadGB: 4.9,
    storageGB: 5.6,
    minimumRamGB: 8,
    contextTokens: 128_000,
    likelySpeed: "moderate",
  },
  {
    id: "qwen2.5-coder:14b-instruct-q4",
    label: "Qwen 2.5 Coder 14B",
    quantization: "Q4",
    downloadGB: 9.1,
    storageGB: 10.2,
    minimumRamGB: 16,
    contextTokens: 32_000,
    likelySpeed: "heavy",
  },
]

export function localModelHardwareProfile(config: DeviceResourceConfig): LocalModelHardwareProfile {
  return {
    ramGB: Number(config.totalRamGB.toFixed(1)),
    cpuCores: config.cpuCores,
    tier: config.tier,
    platform: config.isTermux ? "Termux" : "PC",
    architecture: config.isARM64 ? "ARM64" : "x64/other",
    gpu: "not detected",
  }
}

export function recommendedLocalModels(config: DeviceResourceConfig) {
  return localModelRecommendations(config).filter((item) => item.recommended).map((item) => item.model)
}

export function localModelRecommendations(config: DeviceResourceConfig): LocalModelRecommendation[] {
  const conservativeRamAllowanceGB = Number((config.totalRamGB * 0.7).toFixed(1))
  return LOCAL_MODEL_CATALOG.map((model) => {
    const recommended = model.minimumRamGB <= conservativeRamAllowanceGB
    return {
      model,
      recommended,
      conservativeRamAllowanceGB,
      rationale: recommended
        ? `fits the conservative ${conservativeRamAllowanceGB.toFixed(1)}GB RAM allowance`
        : `needs >=${model.minimumRamGB}GB RAM; conservative allowance is ${conservativeRamAllowanceGB.toFixed(1)}GB`,
    }
  })
}

export function formatLocalModelCatalog(config: DeviceResourceConfig, format: "table" | "json" = "table"): string {
  const profile = localModelHardwareProfile(config)
  const models = localModelRecommendations(config).map((item) => ({
    ...item.model,
    recommended: item.recommended,
    rationale: item.rationale,
  }))
  if (format === "json")
    return JSON.stringify(
      {
        hardware: profile,
        conservativeRamAllowanceGB: Number((config.totalRamGB * 0.7).toFixed(1)),
        backend: "GPU/VRAM is not detected by NEXUS; no GPU acceleration is assumed.",
        downloadsStarted: false,
        models,
      },
      null,
      2,
    )

  const lines = [
    `Local catalog for ${profile.platform} ${profile.architecture}; conservative RAM allowance: ${(config.totalRamGB * 0.7).toFixed(1)}GB`,
    "GPU/VRAM: not detected by NEXUS (no GPU acceleration is assumed)",
    "Model                         Quant  Download  Storage  Min RAM  Context  Class     Fit",
    "─".repeat(94),
  ]
  for (const item of localModelRecommendations(config)) {
    const model = item.model
    lines.push(
      `${model.label.padEnd(29)} ${model.quantization.padEnd(6)} ~${`${model.downloadGB}GB`.padEnd(8)} ~${`${model.storageGB}GB`.padEnd(7)} ${`${model.minimumRamGB}GB`.padEnd(8)} ${`${model.contextTokens / 1000}k`.padEnd(8)} ${model.likelySpeed.padEnd(9)} ${item.recommended ? "recommended" : "not recommended"}`,
    )
  }
  lines.push("Catalog values are approximate; no download or local-model runtime was started.")
  return lines.join("\n")
}

export function formatLocalModelDetail(
  config: DeviceResourceConfig,
  modelID: string,
  format: "table" | "json" = "table",
): string {
  const recommendation = localModelRecommendations(config).find((item) => item.model.id === modelID)
  if (!recommendation) {
    const known = LOCAL_MODEL_CATALOG.map((model) => model.id).join(", ")
    return `Unknown local catalog model: ${modelID}. Known IDs: ${known}. No download or local-model runtime was started.`
  }
  const profile = localModelHardwareProfile(config)
  const detail = {
    hardware: profile,
    model: recommendation.model,
    recommended: recommendation.recommended,
    rationale: recommendation.rationale,
    backend: "GPU/VRAM is not detected by NEXUS; CPU/GPU runtime compatibility is not probed or guaranteed.",
    downloadsStarted: false,
    runtimeStarted: false,
  }
  if (format === "json") return JSON.stringify(detail, null, 2)
  return [
    `Model: ${recommendation.model.label} (${recommendation.model.id})`,
    `Quantization: ${recommendation.model.quantization}`,
    `Estimated download/storage: ~${recommendation.model.downloadGB}GB / ~${recommendation.model.storageGB}GB`,
    `Minimum RAM: >=${recommendation.model.minimumRamGB}GB; context: ~${recommendation.model.contextTokens.toLocaleString()}; likely ${recommendation.model.likelySpeed}`,
    `Recommendation: ${recommendation.recommended ? "yes" : "no"} — ${recommendation.rationale}`,
    "GPU/VRAM: not detected by NEXUS; CPU/GPU runtime compatibility is not probed or guaranteed.",
    "Informational only: no download or local-model runtime was started.",
  ].join("\n")
}

export function formatLocalModelRecommendations(config: DeviceResourceConfig) {
  const profile = localModelHardwareProfile(config)
  const recommendations = localModelRecommendations(config).filter((item) => item.recommended)
  const lines = [
    `Local device: ${profile.platform} ${profile.architecture}; ${profile.ramGB.toFixed(1)}GB RAM; ${profile.cpuCores} CPU cores; ${profile.tier} tier`,
    "GPU/VRAM: not detected by NEXUS (no GPU capability is assumed)",
    "Catalog estimates are approximate; download, storage, speed, and context capacity are not guarantees.",
  ]
  if (profile.platform === "Termux") {
    lines.push(
      "Termux: keep battery, thermal, storage, and metered-network safeguards enabled before any manual local-model setup.",
    )
  }
  if (recommendations.length === 0) {
    lines.push("No catalog entry is conservatively recommended for detected RAM. No download was started.")
    return lines
  }
  lines.push("Recommended catalog (informational only; no download was started):")
  for (const recommendation of recommendations) {
    const model = recommendation.model
    lines.push(
      `- ${model.label} (${model.id}) — ${model.quantization}; ~${model.downloadGB}GB download / ~${model.storageGB}GB storage; >=${model.minimumRamGB}GB RAM; ~${model.contextTokens.toLocaleString()} context; likely ${model.likelySpeed}; ${recommendation.rationale}`,
    )
  }
  return lines
}
