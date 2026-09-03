import { expect, test } from "bun:test"
import { activityLabel } from "../../src/util/activity"

test("uses fixed redacted labels per tool category", () => {
  expect(activityLabel({ tool: "bash" })).toBe("Running tool…")
  expect(activityLabel({ tool: "read" })).toBe("Reading…")
  expect(activityLabel({ tool: "edit" })).toBe("Writing…")
  expect(activityLabel({ tool: "write" })).toBe("Writing…")
  expect(activityLabel({ tool: "grep" })).toBe("Searching…")
  expect(activityLabel({ tool: "glob" })).toBe("Searching…")
  expect(activityLabel({ tool: "webfetch" })).toBe("Fetching…")
  expect(activityLabel({ tool: "task" })).toBe("Delegating…")
  expect(activityLabel({ tool: "mystery_tool" })).toBe("Working…")
})

const SECRET_INPUTS = [
  "/home/user/secret-project/src/token.txt",
  "bun run --eval 'rm -rf /'",
  "https://internal.corp/keys?id=42",
  "my-secret-pattern",
]

test("labels never interpolate user content even when a caller passes rich parts", () => {
  for (const secret of SECRET_INPUTS) {
    for (const tool of ["bash", "read", "edit", "write", "grep", "glob", "webfetch", "task"]) {
      const part = {
        tool,
        state: {
          status: "running" as const,
          input: { command: secret, filePath: secret, url: secret, pattern: secret, query: secret, description: secret },
          time: { start: 0 },
        },
      }
      const label = activityLabel(part as any)
      expect(label).not.toContain(secret)
      expect(label).not.toMatch(/\/|https?:|\s{2,}/)
    }
  }
})
