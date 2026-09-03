import { EOL } from "node:os"
import type { DeviceReadiness } from "./device"
import { specialistRoleNames, specialistRoleSummary } from "./agent-roles"
import type { AgentRun, AgentSchedule, GatewayConnection, LearningProposal, SkillRevision } from "../../agent-platform/store"
import type { LocalGatewayState } from "../../agent-platform/gateway-local"

export type AgentCapabilityStatusInput = {
  learning: LearningProposal[]
  skillRevisions: SkillRevision[]
  schedules: AgentSchedule[]
  runs: AgentRun[]
  gateways: GatewayConnection[]
  device: DeviceReadiness
  localGatewayState?: LocalGatewayState
}

export type AgentCapabilityStatus = {
  learning: {
    proposals: Record<"proposed" | "approved" | "rejected" | "superseded", number>
    approvedSkillRevisions: number
    explicitApprovalRequired: true
  }
  scheduler: {
    definitions: number
    enabledDefinitions: number
    disabledDefinitions: number
    workerStartedByInspection: false
    executionStartedByInspection: false
  }
  subagents: {
    roles: Array<ReturnType<typeof specialistRoleSummary>>
    durablePlans: number
    policyBounds: { maxChildren: "0-12"; maxParallel: "1-12"; maxParallelRule: "lead-plus-children" }
    observedDevice: Pick<DeviceReadiness, "platform" | "architecture" | "cpuCores" | "totalMemoryBytes" | "freeMemoryBytes" | "observedOnly">
    agentStartedByInspection: false
  }
  gateway: {
    registeredConnections: number
    enabledConnections: number
    localProfiles: number
    hostedProfiles: number
    foregroundState: "not-recorded" | "recorded"
    listenerStartedByInspection: false
    remoteConnectionStartedByInspection: false
  }
}

export function agentCapabilityStatus(input: AgentCapabilityStatusInput): AgentCapabilityStatus {
  const proposals = { proposed: 0, approved: 0, rejected: 0, superseded: 0 }
  for (const proposal of input.learning) proposals[proposal.status] += 1
  const enabledDefinitions = input.schedules.filter((schedule) => schedule.enabled).length
  const localProfiles = input.gateways.filter((gateway) => gateway.runtimeMode === "local").length

  return {
    learning: {
      proposals,
      approvedSkillRevisions: input.skillRevisions.length,
      explicitApprovalRequired: true,
    },
    scheduler: {
      definitions: input.schedules.length,
      enabledDefinitions,
      disabledDefinitions: input.schedules.length - enabledDefinitions,
      workerStartedByInspection: false,
      executionStartedByInspection: false,
    },
    subagents: {
      roles: specialistRoleNames.map(specialistRoleSummary),
      durablePlans: input.runs.length,
      policyBounds: { maxChildren: "0-12", maxParallel: "1-12", maxParallelRule: "lead-plus-children" },
      observedDevice: {
        platform: input.device.platform,
        architecture: input.device.architecture,
        cpuCores: input.device.cpuCores,
        totalMemoryBytes: input.device.totalMemoryBytes,
        freeMemoryBytes: input.device.freeMemoryBytes,
        observedOnly: true,
      },
      agentStartedByInspection: false,
    },
    gateway: {
      registeredConnections: input.gateways.length,
      enabledConnections: input.gateways.filter((gateway) => gateway.enabled).length,
      localProfiles,
      hostedProfiles: input.gateways.length - localProfiles,
      foregroundState: input.localGatewayState ? "recorded" : "not-recorded",
      listenerStartedByInspection: false,
      remoteConnectionStartedByInspection: false,
    },
  }
}

function gib(bytes: number) {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`
}

export const agentCapabilitySections = ["learning", "scheduler", "subagents", "gateway"] as const
export type AgentCapabilitySection = (typeof agentCapabilitySections)[number]

function capabilitySectionLines(status: AgentCapabilityStatus): Record<AgentCapabilitySection, string[]> {
  return {
    learning: [
      "Learning records",
      `  Proposals: proposed ${status.learning.proposals.proposed} · approved ${status.learning.proposals.approved} · rejected ${status.learning.proposals.rejected} · superseded ${status.learning.proposals.superseded}`,
      `  Approved skill revisions: ${status.learning.approvedSkillRevisions}`,
      "  Boundary: learning stays proposed until a user explicitly approves it; no prompt, session, or file was learned automatically.",
    ],
    scheduler: [
      "Scheduler capability",
      `  Local definitions: ${status.scheduler.definitions} · enabled ${status.scheduler.enabledDefinitions} · disabled ${status.scheduler.disabledDefinitions}`,
      "  Boundary: this inspection did not create a schedule, start a worker, poll, or claim/run any scheduled job.",
    ],
    subagents: [
      "Subagent capacity",
      `  Roles: ${status.subagents.roles.map((role) => `${role.name} (${role.basePolicy})`).join(", ")}`,
      `  Local plan policy bounds: children ${status.subagents.policyBounds.maxChildren} · parallel ${status.subagents.policyBounds.maxParallel} · parallel must not exceed lead plus children`,
      `  Observed device profile: ${status.subagents.observedDevice.platform} · ${status.subagents.observedDevice.architecture} · ${status.subagents.observedDevice.cpuCores} CPU cores · ${gib(status.subagents.observedDevice.freeMemoryBytes)} free / ${gib(status.subagents.observedDevice.totalMemoryBytes)} total memory`,
      `  Durable plans recorded: ${status.subagents.durablePlans}`,
      "  Boundary: this is observed local metadata only; no agent was started, delegated, queued, or given a model task.",
    ],
    gateway: [
      "Gateway readiness",
      `  Registered profiles: ${status.gateway.registeredConnections} · enabled ${status.gateway.enabledConnections} · local ${status.gateway.localProfiles} · hosted ${status.gateway.hostedProfiles}`,
      `  Foreground local state: ${status.gateway.foregroundState}`,
      "  Boundary: no credential, sender, connection ID, label, listener, remote connection, message, schedule execution, or token was displayed or started.",
    ],
  }
}

export function formatAgentCapabilityStatus(
  status: AgentCapabilityStatus,
  format: "table" | "json",
  section?: AgentCapabilitySection,
): string {
  if (format === "json") return JSON.stringify(section ? { section, status: status[section] } : status, null, 2)
  const sections = capabilitySectionLines(status)
  const lines = section ? sections[section] : agentCapabilitySections.flatMap((item) => sections[item])
  return lines.join(EOL)
}
