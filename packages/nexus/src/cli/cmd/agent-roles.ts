import { EOL } from "node:os"
import { SPECIALIST_ROLE_CONFIGS, SPECIALIST_ROLE_DETAILS } from "@/agent/specialists"

export const specialistRoleNames = ["planner", "coder", "reviewer", "tester"] as const
export type SpecialistRoleName = (typeof specialistRoleNames)[number]

export type SpecialistRoleSummary = {
  name: SpecialistRoleName
  description: string
  basePolicy: "read-first" | "scoped-edit" | "review-only" | "test-only"
  shell: "ask" | "configured"
  edits: "deny" | "configured"
  delegation: "deny" | "configured"
}

const rolePolicy: Record<SpecialistRoleName, Omit<SpecialistRoleSummary, "name" | "description">> = {
  planner: { basePolicy: "read-first", shell: "ask", edits: "deny", delegation: "deny" },
  coder: { basePolicy: "scoped-edit", shell: "configured", edits: "configured", delegation: "configured" },
  reviewer: { basePolicy: "review-only", shell: "ask", edits: "deny", delegation: "deny" },
  tester: { basePolicy: "test-only", shell: "ask", edits: "deny", delegation: "deny" },
}

function safeText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240)
}

export function specialistRoleSummary(name: SpecialistRoleName): SpecialistRoleSummary {
  return {
    name,
    description: safeText(SPECIALIST_ROLE_DETAILS[name].description),
    ...rolePolicy[name],
  }
}

export function formatSpecialistRoles(format: "table" | "json"): string {
  const roles = specialistRoleNames.map(specialistRoleSummary)
  if (format === "json") return JSON.stringify(roles, null, 2)

  const header = "Role      Policy       Shell       Edits        Delegation"
  const lines = [header, "─".repeat(header.length)]
  for (const role of roles) {
    lines.push(
      `${role.name.padEnd(9)} ${role.basePolicy.padEnd(12)} ${role.shell.padEnd(11)} ${role.edits.padEnd(12)} ${role.delegation}`,
    )
  }
  lines.push("Inspect a role with: nexus agent role show <role>")
  lines.push("This inspection does not select a role, change policy, execute tools, or change the current model.")
  return lines.join(EOL)
}

export function formatSpecialistRole(name: SpecialistRoleName, format: "table" | "json"): string {
  const summary = specialistRoleSummary(name)
  const configured = name === "coder" ? undefined : SPECIALIST_ROLE_CONFIGS[name]
  const detail = {
    ...summary,
    promptIntent: safeText(SPECIALIST_ROLE_DETAILS[name].prompt),
    baseRules: configured
      ? Object.entries(configured).map(([permission, action]) => ({ permission, action }))
      : "Uses existing configured agent/session policy; no new override is introduced by inspection.",
    inspectionOnly: true,
  }
  if (format === "json") return JSON.stringify(detail, null, 2)

  const lines = [
    `Role: ${detail.name}`,
    `Purpose: ${detail.description}`,
    `Base policy: ${detail.basePolicy}`,
    `Shell: ${detail.shell}`,
    `Edits: ${detail.edits}`,
    `Delegation: ${detail.delegation}`,
    `Intent: ${detail.promptIntent}`,
    "Base rules:",
  ]
  if (typeof detail.baseRules === "string") lines.push(`  ${detail.baseRules}`)
  else for (const rule of detail.baseRules) lines.push(`  ${rule.permission}: ${rule.action}`)
  lines.push("Inspection only: no role selection, policy update, tool execution, or model change occurred.")
  return lines.join(EOL)
}
