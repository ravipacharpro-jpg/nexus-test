import { createHash } from "node:crypto"
import type { AdaptiveIntent } from "./adaptive-intent"
import type { IncidentReport } from "./incident-response"
import { isRiskyAction } from "../agent/master"

export type SelfImprovementProposal = {
  id: string
  title: string
  reason: string
  scope: string[]
  verification: string[]
  status: "proposed" | "verified" | "blocked"
  requiresApproval: boolean
  activatesAutomatically: boolean
  decision: "auto_apply_after_tests" | "awaiting_approval" | "blocked"
}

export function proposeIncidentRepair(report: IncidentReport): SelfImprovementProposal | undefined {
  const incident = report.incidents.find((item) => item.severity === "critical" || item.severity === "error")
  if (!incident) return undefined
  const title = `Repair recurring ${incident.source} failure ${incident.fingerprint}`
  const id = createHash("sha256").update(`incident\0${incident.fingerprint}`).digest("hex").slice(0, 20)
  return {
    id,
    title,
    reason: `A ${incident.severity} ${incident.source} incident was observed: ${incident.message}`,
    scope: [
      "Reproduce the incident from redacted evidence only.",
      "Implement the smallest typed repair inside the workspace.",
      "Preserve Termux resource limits and existing permission boundaries.",
    ],
    verification: [
      "Run focused regression tests and collect hashed receipts.",
      "Verify secrets and raw user payloads are absent from the evidence.",
      "Register the capability only after the repair passes verification.",
    ],
    status: "proposed",
    requiresApproval: true,
    activatesAutomatically: false,
    decision: "awaiting_approval",
  }
}

export function proposeSelfImprovement(intent: AdaptiveIntent): SelfImprovementProposal | undefined {
  if (intent.capabilityGaps.length === 0) return undefined
  const title = `Add safe adapter: ${intent.capabilityGaps.join(", ")}`
  const id = createHash("sha256").update(`${intent.objective}\0${title}`).digest("hex").slice(0, 20)
  return {
    id,
    title,
    reason: `The current task requires ${intent.capabilityGaps.join(", ")}, which is not available on this device.`,
    scope: [
      "Add a typed adapter behind the existing permission boundary.",
      "Add deterministic focused tests and capability detection.",
      "Keep unsupported behavior blocked until verification passes.",
    ],
    verification: [
      "Run targeted formatting, lint, and regression tests.",
      "Verify no secrets or arbitrary shell commands enter the adapter.",
      "Require explicit approval before external mutations or activation.",
    ],
    status: "proposed",
    requiresApproval: true,
    activatesAutomatically: false,
    decision: "awaiting_approval",
  }
}

export function planAutonomousInternalUpgrade(input: {
  proposal: SelfImprovementProposal
  workspace: string
  changedFiles: string[]
  actionSummary: string
}): SelfImprovementProposal {
  const insideWorkspace = input.changedFiles.every((file) => !file.startsWith("/") && !file.includes(".."))
  const risky = isRiskyAction(input.actionSummary)
  if (!insideWorkspace || risky) {
    return { ...input.proposal, requiresApproval: true, activatesAutomatically: false, decision: "awaiting_approval" }
  }
  return {
    ...input.proposal,
    requiresApproval: false,
    activatesAutomatically: true,
    decision: "auto_apply_after_tests",
  }
}

export function markProposalVerified(proposal: SelfImprovementProposal, verified: boolean): SelfImprovementProposal {
  return {
    ...proposal,
    status: verified ? "verified" : "blocked",
    decision:
      verified && proposal.decision === "auto_apply_after_tests"
        ? "auto_apply_after_tests"
        : verified
          ? "awaiting_approval"
          : "blocked",
  }
}

export function proposalSummary(proposal: SelfImprovementProposal): string {
  return `${proposal.status}: ${proposal.title}. Approval required=${proposal.requiresApproval}; automatic activation=${proposal.activatesAutomatically}.`
}

export * as SelfImprovement from "./self-improvement"
