import { describe, expect, test } from "bun:test"
import {
  formatSpecialistRole,
  formatSpecialistRoles,
  specialistRoleNames,
  specialistRoleSummary,
} from "../../src/cli/cmd/agent-roles"

describe("specialist role inspection", () => {
  test("lists only the registered first-party specialist roles and their factual baseline constraints", () => {
    const table = formatSpecialistRoles("table")
    const json = formatSpecialistRoles("json")

    expect(specialistRoleNames).toEqual(["planner", "coder", "reviewer", "tester"])
    expect(table).toContain("planner")
    expect(table).toContain("reviewer")
    expect(table).toContain("This inspection does not select a role")
    expect(json).toContain('"basePolicy": "review-only"')
    expect(json).not.toContain("sk-")
  })

  test("shows reviewer and tester as non-editing non-delegating roles while leaving coder policy configured", () => {
    expect(specialistRoleSummary("reviewer")).toMatchObject({ shell: "ask", edits: "deny", delegation: "deny" })
    expect(specialistRoleSummary("tester")).toMatchObject({ shell: "ask", edits: "deny", delegation: "deny" })
    expect(specialistRoleSummary("coder")).toMatchObject({
      shell: "configured",
      edits: "configured",
      delegation: "configured",
    })

    const reviewer = formatSpecialistRole("reviewer", "table")
    const coder = formatSpecialistRole("coder", "json")
    expect(reviewer).toContain("edit: deny")
    expect(reviewer).toContain("task: deny")
    expect(reviewer).toContain("Inspection only")
    expect(coder).toContain("Uses existing configured agent/session policy")
  })
})
