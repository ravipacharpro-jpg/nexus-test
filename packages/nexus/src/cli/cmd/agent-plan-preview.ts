import { EOL } from "node:os"
import type { DeviceReadiness } from "./device"
import { specialistRoleSummary, type SpecialistRoleName } from "./agent-roles"

export type AgentPlanPreviewInput = {
  role: SpecialistRoleName
  children: number
  parallel: number
  budget: "low" | "standard" | "high"
  device: DeviceReadiness
}

export type AgentPlanPreview = {
  role: ReturnType<typeof specialistRoleSummary>
  policy: { maxChildren: number; maxParallel: number; budgetClass: "low" | "standard" | "high" }
  observedDevice: Pick<DeviceReadiness, "platform" | "architecture" | "cpuCores" | "totalMemoryBytes" | "freeMemoryBytes" | "observedOnly">
  guidance: string
  persistentRunCreated: false
  agentStarted: false
  taskDelegated: false
}

export function createAgentPlanPreview(input: AgentPlanPreviewInput): AgentPlanPreview {
  if (!Number.isSafeInteger(input.children) || input.children < 0 || input.children > 12) throw new Error("children must be a whole number from 0 to 12")
  if (!Number.isSafeInteger(input.parallel) || input.parallel < 1 || input.parallel > 12) throw new Error("parallel must be a whole number from 1 to 12")
  if (input.parallel > input.children + 1) throw new Error("parallel cannot exceed lead plus children")
  const freeGiB = input.device.freeMemoryBytes / (1024 * 1024 * 1024)
  const guidance =
    freeGiB < 1
      ? "Low free memory observed: prefer a lead-only or serial plan. This is guidance, not an execution decision."
      : freeGiB < 3
        ? "Limited free memory observed: keep child count and parallelism bounded. This is guidance, not an execution decision."
        : "Observed local memory is compatible with the requested bounded plan; this is not a performance guarantee."
  return {
    role: specialistRoleSummary(input.role),
    policy: { maxChildren: input.children, maxParallel: input.parallel, budgetClass: input.budget },
    observedDevice: {
      platform: input.device.platform,
      architecture: input.device.architecture,
      cpuCores: input.device.cpuCores,
      totalMemoryBytes: input.device.totalMemoryBytes,
      freeMemoryBytes: input.device.freeMemoryBytes,
      observedOnly: true,
    },
    guidance,
    persistentRunCreated: false,
    agentStarted: false,
    taskDelegated: false,
  }
}

export function formatAgentPlanPreview(preview: AgentPlanPreview, format: "table" | "json"): string {
  if (format === "json") return JSON.stringify(preview, null, 2)
  return [
    `Role: ${preview.role.name} · ${preview.role.basePolicy}`,
    `Requested bounded policy: lead + up to ${preview.policy.maxChildren} children · max ${preview.policy.maxParallel} parallel · ${preview.policy.budgetClass} budget`,
    `Observed device: ${preview.observedDevice.platform} · ${preview.observedDevice.architecture} · ${preview.observedDevice.cpuCores} CPU cores`,
    `Guidance: ${preview.guidance}`,
    "Boundary: preview only. No agent was started, delegated, queued, persisted, or given a model task; no schedule, source, session, provider, or remote state changed.",
  ].join(EOL)
}
