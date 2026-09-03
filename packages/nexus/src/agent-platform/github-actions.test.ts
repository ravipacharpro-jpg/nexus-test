import { planGitHubAction } from "./github-actions"

describe("GitHub action planner", () => {
  test("normalizes repository URLs and creates an approval-only idempotency plan", () => {
    const plan = planGitHubAction({
      kind: "createPullRequest",
      repository: "https://github.com/itzgeniusboy/nexus-fixed.git",
      intent: "Open a repair pull request after verification",
    })

    expect(plan.repository).toBe("itzgeniusboy/nexus-fixed")
    expect(plan.requiresApproval).toBe(true)
    expect(plan.mutation).toBe(false)
    expect(plan.idempotencyKey).toMatch(/^[a-f0-9]{32}$/)
    expect(plan.summary).toMatch(/Approval required/i)
  })

  test("rejects malformed repositories and empty intents", () => {
    expect(() => planGitHubAction({ kind: "push", repository: "github.com/no-owner", intent: "push" })).toThrow(
      "owner/name",
    )
    expect(() => planGitHubAction({ kind: "push", repository: "owner/name", intent: "  " })).toThrow(
      "intent is required",
    )
  })
})
