import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  checkApiUsageBudget,
  getApiUsageBudget,
  recordApiUsage,
  resetApiVaultForTests,
  setApiUsageBudget,
} from "../../src/api/ApiVault"

const originalHome = process.env.HOME
const homes: string[] = []

function useTemporaryHome() {
  const home = mkdtempSync(join(tmpdir(), "nexus-vault-budget-"))
  homes.push(home)
  process.env.HOME = home
  resetApiVaultForTests()
}

afterEach(() => {
  resetApiVaultForTests()
  process.env.HOME = originalHome
  while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true })
})

describe("API Vault local usage budget", () => {
  test("defaults to unset local caps and never represents provider quota", () => {
    useTemporaryHome()
    expect(getApiUsageBudget()).toEqual({ version: 1 })
    expect(checkApiUsageBudget({ provider: "groq" })).toEqual({ allowed: true })
  })

  test("blocks only the configured task and NEXUS-observed daily limits", () => {
    useTemporaryHome()
    setApiUsageBudget({ maxRequestsPerTask: 2, maxTokensPerTask: 100, maxRequestsPerDay: 3, maxTokensPerDay: 120 })

    expect(checkApiUsageBudget({ provider: "groq", taskRequests: 2 })).toEqual({
      allowed: false,
      reason: "task_request_cap",
    })
    expect(checkApiUsageBudget({ provider: "groq", taskTokens: 90, nextTokens: 11 })).toEqual({
      allowed: false,
      reason: "task_token_cap",
    })

    setApiUsageBudget({ maxRequestsPerTask: 10, maxTokensPerTask: 200 })
    recordApiUsage("groq", 40, 50)
    expect(checkApiUsageBudget({ provider: "groq", nextTokens: 31 })).toEqual({
      allowed: false,
      reason: "daily_token_cap",
    })
    recordApiUsage("groq", 0, 0)
    recordApiUsage("groq", 0, 0)
    expect(checkApiUsageBudget({ provider: "groq", nextRequests: 1 })).toEqual({
      allowed: false,
      reason: "daily_request_cap",
    })
  })

  test("allows explicit zero to clear a cap without changing observed usage", () => {
    useTemporaryHome()
    setApiUsageBudget({ maxRequestsPerTask: 1, maxTokensPerDay: 50 })
    const budget = setApiUsageBudget({ maxRequestsPerTask: 0 })
    expect(budget).toEqual({ version: 1, maxTokensPerDay: 50 })
    expect(checkApiUsageBudget({ provider: "groq", taskRequests: 100 })).toEqual({ allowed: true })
  })
})
