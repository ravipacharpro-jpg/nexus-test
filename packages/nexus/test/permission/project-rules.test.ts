import { describe, expect, test } from "bun:test"
import { Permission } from "../../src/permission"
import { formatPermissionInspection, inspectablePermissionCategories } from "../../src/cli/cmd/permission"

describe("project permission rules", () => {
  test("applies project config as an explicit baseline while retaining default ask", () => {
    const rules = Permission.projectRules({ bash: { "git status": "allow", "rm *": "deny" } }, [], [])
    expect(Permission.evaluate("bash", "git status", rules).action).toBe("allow")
    expect(Permission.evaluate("bash", "rm build", rules).action).toBe("deny")
    expect(Permission.evaluate("webfetch", "https://example.test", rules).action).toBe("ask")
  })

  test("agent and temporary session controls override project baseline without exposing arguments or secrets", () => {
    const rules = Permission.projectRules(
      { bash: "deny", edit: "ask" },
      [{ permission: "bash", pattern: "git *", action: "allow" }],
      [{ permission: "edit", pattern: "src/**", action: "allow" }],
    )
    expect(Permission.evaluate("bash", "git status", rules).action).toBe("allow")
    expect(Permission.evaluate("bash", "curl https://example.test", rules).action).toBe("deny")
    expect(Permission.evaluate("edit", "src/app.ts", rules).action).toBe("allow")
  })

  test("explains only action and policy layer, never the matched command or pattern", () => {
    const decision = Permission.explainDecision({
      permission: "bash",
      pattern: "curl https://example.test?token=secret-value",
      project: Permission.fromConfig({ bash: "deny" }),
      agent: [{ permission: "bash", pattern: "git *", action: "allow" }],
      session: [],
    })
    expect(decision).toEqual({ permission: "bash", action: "deny", source: "project" })
    expect(JSON.stringify(decision)).not.toContain("secret-value")
  })

  test("formats only fixed safe categories and decision metadata for CLI inspection", () => {
    const secretPath = "/private/project/.env?token=secret-value"
    const decision = Permission.explainDecision({
      permission: "bash",
      pattern: secretPath,
      project: Permission.fromConfig({ bash: "deny" }),
    })
    const output = formatPermissionInspection(decision)

    expect(inspectablePermissionCategories).toEqual(["bash", "edit", "read", "webfetch", "question"])
    expect(output).toContain("Permission: bash")
    expect(output).toContain("Action: deny")
    expect(output).toContain("Source: project")
    expect(output).not.toContain(secretPath)
    expect(output).not.toContain("secret-value")
  })
})
