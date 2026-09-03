import { checkApiUsageBudget, type ApiUsageBudgetDecision } from "@/api/ApiVault"

export type TaskUsageState = { requests: number; tokens: number }

export type CompletedUsage = {
  inputTokens?: number
  outputTokens?: number
  requests?: number
}

export function emptyTaskUsage(): TaskUsageState {
  return { requests: 0, tokens: 0 }
}

export function checkTaskUsageBudget(provider: string, usage: TaskUsageState): ApiUsageBudgetDecision {
  if (provider === "ollama") return { allowed: true }
  return checkApiUsageBudget({
    provider,
    taskRequests: usage.requests,
    taskTokens: usage.tokens,
    nextRequests: 1,
  })
}

/** This text intentionally does not resemble a provider failure, so route fallback must not run. */
export function localBudgetFailure(reason: Exclude<ApiUsageBudgetDecision, { allowed: true }>["reason"]): string {
  return `NEXUS local usage cap reached (${reason}); no provider quota or balance was checked.`
}

export function recordCompletedUsage(state: TaskUsageState, usage: CompletedUsage): Required<CompletedUsage> {
  const inputTokens = Math.max(0, Math.round(usage.inputTokens ?? 0))
  const outputTokens = Math.max(0, Math.round(usage.outputTokens ?? 0))
  const requests = Math.max(1, Math.round(usage.requests ?? 1))
  state.requests += requests
  state.tokens += inputTokens + outputTokens
  return { inputTokens, outputTokens, requests }
}
