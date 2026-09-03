import type { AgentCapabilities } from "./capabilities"

export type AdaptiveIntentKind =
  | "bug_fix"
  | "web_testing"
  | "android_testing"
  | "browser_task"
  | "project_build"
  | "research"
  | "documentation"
  | "general"

export type AdaptiveIntent = {
  kind: AdaptiveIntentKind
  objective: string
  signals: string[]
  requestedWorkers: Array<"research" | "browser" | "web" | "android" | "coder" | "reviewer" | "tester" | "docs">
  capabilityGaps: string[]
  requiresUserTakeover: boolean
  requiresApproval: boolean
}

export type RequirementMemory = {
  objective: string
  requirements: string[]
  constraints: string[]
  pendingQuestions: string[]
  revisions: string[]
}

const patterns: Array<[AdaptiveIntentKind, RegExp, string]> = [
  ["android_testing", /android|apk|gradle|adb|emulator|mobile/i, "Android/APK signal"],
  ["web_testing", /website|web app|frontend|ui|button|visual|browser test|page/i, "web/UI testing signal"],
  ["browser_task", /browser|login|sign in|click|form|captcha|otp|scrape/i, "interactive browser signal"],
  ["bug_fix", /bug|fix|broken|not working|error|repair|debug/i, "bug-fixing signal"],
  ["project_build", /build|create|make|implement|new project|app|backend|api|cli/i, "project-building signal"],
  ["research", /research|investigate|analy[sz]e|compare|find out/i, "research signal"],
  ["documentation", /docs|document|readme|guide/i, "documentation signal"],
]

export function classifyAdaptiveIntent(objective: string, capabilities: AgentCapabilities): AdaptiveIntent {
  const text = objective.trim()
  const matches = patterns.filter(([, pattern]) => pattern.test(text))
  const kind = matches[0]?.[0] ?? "general"
  const workers = new Set<AdaptiveIntent["requestedWorkers"][number]>(["coder", "reviewer", "tester"])
  if (matches.some(([candidate]) => candidate === "research")) workers.add("research")
  if (matches.some(([candidate]) => candidate === "browser_task" || candidate === "web_testing")) workers.add("browser")
  if (matches.some(([candidate]) => candidate === "web_testing" || candidate === "project_build")) workers.add("web")
  if (matches.some(([candidate]) => candidate === "android_testing")) workers.add("android")
  if (matches.some(([candidate]) => candidate === "documentation")) workers.add("docs")
  const capabilityGaps: string[] = []
  if (workers.has("browser") && !capabilities.browserAutomation && !capabilities.browserHttpInspection)
    capabilityGaps.push("browser inspection/automation adapter")
  if (workers.has("android") && !capabilities.android) capabilityGaps.push("Android tooling")
  if (workers.has("web") && !capabilities.webRuntime) capabilityGaps.push("web runtime")
  return {
    kind,
    objective: text,
    signals: matches.map(([, , signal]) => signal),
    requestedWorkers: [...workers],
    capabilityGaps,
    requiresUserTakeover: /login|sign in|password|otp|2fa|captcha|personal data/i.test(text),
    requiresApproval: /publish|payment|delete|merge|push|send|deploy|external/i.test(text),
  }
}

export function createRequirementMemory(objective: string): RequirementMemory {
  return { objective: objective.trim(), requirements: [], constraints: [], pendingQuestions: [], revisions: [] }
}

export function reviseRequirementMemory(memory: RequirementMemory, update: string): RequirementMemory {
  const text = update.trim()
  if (!text) return structuredClone(memory)
  const next = structuredClone(memory)
  next.revisions.push(text)
  if (/must|need|should|chahiye|chahta/i.test(text)) next.requirements.push(text)
  if (/only|never|without|safe|termux|pc|approval|no secret/i.test(text)) next.constraints.push(text)
  next.objective = `${memory.objective}\n${text}`.trim()
  return next
}

export function capabilityGapSummary(intent: AdaptiveIntent): string {
  return intent.capabilityGaps.length
    ? `Capability gaps: ${intent.capabilityGaps.join(", ")}. The Master task must remain blocked until a safe adapter is available.`
    : "All required capability categories are available for planning."
}

export * as AdaptiveIntent from "./adaptive-intent"
