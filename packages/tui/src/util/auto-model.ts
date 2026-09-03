import type { Model, Provider } from "@nexus-ai/sdk/v2"

export type AutoKeyHealth = {
  provider: string
  keys: Array<{ status: string }>
}

export type AutoModelInput = {
  task: string
  hasImage?: boolean
  providers: Provider[]
  connected?: Array<string>
  keyHealth?: Array<AutoKeyHealth>
  quarantined?: ReadonlyArray<string>
  /** When non-empty, Auto only switches among these user-selected models. */
  selectedModels?: ReadonlyArray<{ providerID: string; modelID: string }>
}

export type AutoModelChoice = {
  providerID: string
  modelID: string
  reason: string
}

const PROVIDER_PRIORITY: Record<string, number> = {
  nexus: 0,
  "nexus-go": 1,
  openai: 2,
  "github-copilot": 3,
  anthropic: 4,
  google: 5,
}

function providerPriority(providerID: string) {
  return PROVIDER_PRIORITY[providerID] ?? 99
}

export function routeKey(providerID: string, modelID: string) {
  return `${providerID}/${modelID}`
}

/**
 * Local-only heuristic; callers must not log or retain its source text.
 * Plain chat resolves to the cheapest capable model so conversational turns stay
 * fast and free-tier friendly, while tool/vision/reasoning tasks prefer model
 * strength over cost.
 *
 * Catalog visibility never implies a usable route: when credential state is
 * supplied, only configured providers with at least one usable key are eligible,
 * quarantined routes are skipped, and deprecated models are excluded.
 */
export function resolveAutoModel(input: AutoModelInput): AutoModelChoice | undefined {
  const requirements = classify(input.task, input.hasImage === true)
  const selected = input.selectedModels
  const usable = input.providers
    .flatMap((provider) => Object.values(provider.models).map((model) => ({ provider, model })))
    .filter(
      ({ provider, model }) =>
        model.status !== "deprecated" &&
        supports(model, requirements) &&
        !input.quarantined?.includes(routeKey(provider.id, model.id)) &&
        configured(provider.id, input) &&
        (!selected || selected.length === 0 ||
          selected.some((m) => m.providerID === provider.id && m.modelID === model.id)),
    )
  if (usable.length === 0) return undefined
  // Enforce capabilities first, then choose the cheapest suitable route.
  // Strong models are used only when the task requires a capability that a
  // cheaper candidate does not provide.
  const pick = [...usable].sort(byTaskFit)[0]
  return (
    pick && {
      providerID: pick.provider.id,
      modelID: pick.model.id,
      reason: requirements.vision
        ? "vision"
        : requirements.tools
          ? "tools"
          : requirements.reasoning
            ? "reasoning"
            : requirements.longContext
              ? "context"
              : "chat",
    }
  )
}

function classify(task: string, hasImage: boolean) {
  const normalized = task.trim().toLowerCase()
  return {
    tools: /\b(?:code|implement|build|fix|refactor|terminal|bash|shell|git|test|debug|edit|file|deploy)\b/.test(
      normalized,
    ),
    vision: hasImage || /\b(?:image|screenshot|photo|picture|visual|ocr)\b/.test(normalized),
    longContext:
      /\b(?:repository|repo|codebase|multi[- ]file|multiple files|whole project|large document|long document)\b/.test(
        normalized,
      ),
    reasoning: /\b(?:reason(?:ing)?|analy[sz]e|diagnose|trade[- ]?off|architecture|plan)\b/.test(normalized),
  }
}

type Requirements = ReturnType<typeof classify>

function supports(model: Model, requirements: Requirements) {
  if (requirements.tools && !model.capabilities.toolcall) return false
  if (requirements.vision && !(model.capabilities.attachment || model.capabilities.input.image)) return false
  if (requirements.longContext && model.limit.context < 32_000) return false
  if (requirements.reasoning && !model.capabilities.reasoning) return false
  return true
}

function byTaskFit(left: { provider: Provider; model: Model }, right: { provider: Provider; model: Model }) {
  const cost = (left.model.cost?.input ?? 0) - (right.model.cost?.input ?? 0)
  if (cost !== 0) return cost

  // When price is equal, prefer the smaller context window to reduce
  // unnecessary memory and prompt overhead.
  const context = left.model.limit.context - right.model.limit.context
  if (context !== 0) return context

  // Keep deterministic provider ordering as the final tie-breaker.
  return (
    providerPriority(left.provider.id) - providerPriority(right.provider.id) ||
    left.model.id.localeCompare(right.model.id)
  )
}

// With no credential state at all the legacy behavior applies so pure callers
// keep working; production always passes server connection state.
function configured(providerID: string, input: AutoModelInput) {
  if (input.connected === undefined && input.keyHealth === undefined) return true
  if (input.connected && !input.connected.includes(providerID)) return false
  const keys = input.keyHealth?.find((item) => item.provider === providerID)?.keys ?? []
  // Multiple keys per provider: any key not locally known-bad keeps routes eligible.
  if (keys.length > 0) return keys.some((key) => key.status !== "invalid" && key.status !== "suspended")
  return true
}
