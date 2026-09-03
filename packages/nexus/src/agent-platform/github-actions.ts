import { createHash } from "node:crypto"

export type GitHubActionKind = "push" | "createIssue" | "createPullRequest" | "mergePullRequest"

export type GitHubActionPlan = {
  kind: GitHubActionKind
  repository: string
  summary: string
  idempotencyKey: string
  requiresApproval: true
  mutation: false
}

function repositoryName(value: string) {
  const raw = value.trim()
  if (/^github\.com\//i.test(raw)) throw new Error("GitHub repository must use the owner/name form")
  const repository = raw
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "")
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("GitHub repository must use the owner/name form")
  }
  return repository
}

export function planGitHubAction(input: {
  kind: GitHubActionKind
  repository: string
  intent: string
}): GitHubActionPlan {
  const repository = repositoryName(input.repository)
  const intent = input.intent.trim()
  if (!intent) throw new Error("GitHub action intent is required")
  const idempotencyKey = createHash("sha256")
    .update(`${input.kind}\0${repository}\0${intent}`)
    .digest("hex")
    .slice(0, 32)
  return {
    kind: input.kind,
    repository,
    summary: `Approval required before GitHub ${input.kind} action on ${repository}: ${intent.slice(0, 240)}`,
    idempotencyKey,
    requiresApproval: true,
    mutation: false,
  }
}

export * as GitHubActions from "./github-actions"
