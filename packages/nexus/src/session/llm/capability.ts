export type TaskRequirements = {
  tools: boolean
  vision: boolean
  longContext: boolean
  reasoning: boolean
}

export type CapabilityModel = {
  capabilities: {
    toolcall: boolean
    reasoning: boolean
    attachment: boolean
    input: { image: boolean }
  }
  limit: { context: number }
}

/** Local-only heuristic; callers must not log or retain its source text. */
export function classifyTaskRequirements(task: string): TaskRequirements {
  const normalized = task.trim().toLowerCase()
  return {
    tools: /\b(?:code|implement|build|fix|refactor|terminal|bash|shell|git|test|debug|edit|file|deploy)\b/.test(
      normalized,
    ),
    vision: /\b(?:image|screenshot|photo|picture|visual|ocr)\b/.test(normalized),
    longContext:
      /\b(?:repository|repo|codebase|multi[- ]file|multiple files|whole project|large document|long document)\b/.test(
        normalized,
      ),
    reasoning: /\b(?:reason(?:ing)?|analy[sz]e|diagnose|trade[- ]?off|architecture|plan)\b/.test(normalized),
  }
}

export function supportsTaskRequirements(model: CapabilityModel, requirements: TaskRequirements): boolean {
  if (requirements.tools && !model.capabilities.toolcall) return false
  if (requirements.vision && !(model.capabilities.attachment || model.capabilities.input.image)) return false
  if (requirements.longContext && model.limit.context < 32_000) return false
  if (requirements.reasoning && !model.capabilities.reasoning) return false
  return true
}

export function taskTextFromMessages(messages: readonly unknown[]): string {
  return messages
    .flatMap((message) => {
      if (!message || typeof message !== "object") return []
      const content = (message as { content?: unknown }).content
      if (typeof content === "string") return [content]
      if (!Array.isArray(content)) return []
      return content.flatMap((part) => {
        if (!part || typeof part !== "object") return []
        const text = (part as { type?: unknown; text?: unknown }).text
        return typeof text === "string" ? [text] : []
      })
    })
    .join("\n")
}
