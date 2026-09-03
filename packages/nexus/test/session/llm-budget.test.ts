import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resetApiVaultForTests, setApiUsageBudget } from "../../src/api/ApiVault"
import {
  checkTaskUsageBudget,
  emptyTaskUsage,
  localBudgetFailure,
  recordCompletedUsage,
} from "../../src/session/llm/budget"

const originalHome = process.env.HOME

function withTemporaryHome() {
  const home = mkdtempSync(join(tmpdir(), "nexus-session-budget-"))
  process.env.HOME = home
  resetApiVaultForTests()
  return () => {
    resetApiVaultForTests()
    process.env.HOME = originalHome
    rmSync(home, { recursive: true, force: true })
  }
}

describe("session local budget helpers", () => {
  test("denies a configured local request cap without classifying it as provider failure", () => {
    const cleanup = withTemporaryHome()
    try {
      setApiUsageBudget({ maxRequestsPerTask: 1 })
      const usage = emptyTaskUsage()
      recordCompletedUsage(usage, { requests: 1 })
      const decision = checkTaskUsageBudget("groq", usage)
      expect(decision).toEqual({ allowed: false, reason: "task_request_cap" })
      if (!decision.allowed)
        expect(localBudgetFailure(decision.reason)).toContain("no provider quota or balance was checked")
    } finally {
      cleanup()
    }
  })

  test("records only completed actual usage and leaves local Ollama preflight eligible", () => {
    const usage = emptyTaskUsage()
    expect(recordCompletedUsage(usage, { inputTokens: 12, outputTokens: 7, requests: 2 })).toEqual({
      inputTokens: 12,
      outputTokens: 7,
      requests: 2,
    })
    expect(usage).toEqual({ requests: 2, tokens: 19 })
    expect(checkTaskUsageBudget("ollama", usage)).toEqual({ allowed: true })
  })
})
