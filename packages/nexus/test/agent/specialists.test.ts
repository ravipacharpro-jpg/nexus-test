import { describe, expect, test } from "bun:test"
import { Permission } from "../../src/permission"
import { SPECIALIST_ROLE_CONFIGS, SPECIALIST_ROLE_DETAILS } from "../../src/agent/specialists"

describe("first-party specialist roles", () => {
  test("provides bounded non-secret role hand-offs", () => {
    expect(Object.keys(SPECIALIST_ROLE_DETAILS).sort()).toEqual(["coder", "planner", "reviewer", "tester"])
    expect(SPECIALIST_ROLE_DETAILS.reviewer.prompt).toContain("Review only")
    expect(SPECIALIST_ROLE_DETAILS.tester.prompt).toContain("Test only")
  })

  test("reviewer and tester cannot silently edit or delegate work", () => {
    for (const role of ["reviewer", "tester"] as const) {
      const rules = Permission.fromConfig(SPECIALIST_ROLE_CONFIGS[role])
      expect(Permission.evaluate("edit", "src/app.ts", rules).action).toBe("deny")
      expect(Permission.evaluate("task", "general", rules).action).toBe("deny")
      expect(Permission.evaluate("bash", "git status", rules).action).toBe("ask")
    }
  })
})
