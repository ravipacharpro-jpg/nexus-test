export type AutoModelRequirements = {
  tools?: boolean
  vision?: boolean
  longContext?: boolean
  reasoning?: boolean
}

/**
 * Uses only local task text. It never sends a paid classification request and
 * intentionally keeps uncertain tasks eligible for normal chat models.
 */
export function classifyTaskRequirements(task: string): AutoModelRequirements {
  const normalized = task.trim().toLowerCase()
  if (!normalized) return {}

  return {
    tools: /\b(?:code|implement|build|fix|refactor|terminal|bash|shell|git|test|debug|edit|file|deploy)\b/.test(normalized),
    vision: /\b(?:image|screenshot|photo|picture|visual|ocr)\b/.test(normalized),
    longContext: /\b(?:repository|repo|codebase|multi[- ]file|multiple files|whole project|large document|long document)\b/.test(normalized),
    reasoning: /\b(?:reason(?:ing)?|analy[sz]e|diagnose|trade[- ]?off|architecture|plan)\b/.test(normalized),
  }
}
