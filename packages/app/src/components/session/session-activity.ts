import type { Part, SessionStatus } from "@nexus-ai/sdk/v2"

export type SessionActivityTone = "active" | "warning" | "error" | "muted"

export type SessionActivity = {
  phase: "working" | "thinking" | "writing" | "tool" | "waiting" | "fallback" | "error"
  label: string
  glyph: string
  tone: SessionActivityTone
}

type PartRecord = Record<string, unknown>

function record(value: unknown): PartRecord | undefined {
  return value !== null && typeof value === "object" ? (value as PartRecord) : undefined
}

function valueAt(value: unknown, ...keys: string[]) {
  let current: unknown = value
  for (const key of keys) {
    const next = record(current)
    if (!next) return
    current = next[key]
  }
  return current
}

function toolLabel(part: Part) {
  const candidate = [valueAt(part, "tool"), valueAt(part, "name"), valueAt(part, "state", "title")].find(
    (value): value is string => typeof value === "string",
  )
  const tool = candidate?.toLowerCase()
  if (!tool) return

  if (/(test|vitest|jest|pytest|bun test|npm test)/.test(tool)) return "Testing"
  if (/(read|grep|glob|search|scan|list|find)/.test(tool)) return "Reading"
  if (/(write|edit|patch|apply|create)/.test(tool)) return "Writing"
  if (/(upload|push)/.test(tool)) return "Uploading"
  if (/(download|pull|fetch)/.test(tool)) return "Downloading"
  return "Running tool"
}

export function deriveSessionActivity(input: {
  status: SessionStatus | undefined
  parts: readonly Part[]
  error?: unknown
  waiting?: boolean
  completed?: boolean
}): SessionActivity | undefined {
  const status = input.status
  if (input.error) return { phase: "error", label: "Action failed", glyph: "!", tone: "error" }
  if (input.waiting) return { phase: "waiting", label: "Waiting for approval", glyph: "‖", tone: "warning" }
  if (input.completed) return { phase: "working", label: "Completed", glyph: "✓", tone: "muted" }
  if (!status || status.type === "idle") return

  if (status.type === "retry") {
    return { phase: "fallback", label: "Retrying route", glyph: "↻", tone: "warning" }
  }

  const latest = input.parts.at(-1)
  if (!latest) return { phase: "working", label: "Working", glyph: "◌", tone: "active" }
  const type = (latest as { type?: string }).type
  if (type === "reasoning") return { phase: "thinking", label: "Thinking", glyph: "✦", tone: "active" }
  if (type === "text") return { phase: "writing", label: "Writing response", glyph: "✎", tone: "active" }
  if (type === "tool") {
    const label = toolLabel(latest)
    if (label === "Testing") return { phase: "tool", label, glyph: "✓", tone: "active" }
    if (label === "Reading") return { phase: "tool", label, glyph: "⌕", tone: "active" }
    if (label === "Writing") return { phase: "tool", label, glyph: "✎", tone: "active" }
    if (label === "Uploading") return { phase: "tool", label, glyph: "↑", tone: "active" }
    if (label === "Downloading") return { phase: "tool", label, glyph: "↓", tone: "active" }
    return { phase: "tool", label: label ?? "Running tool", glyph: "⌘", tone: "active" }
  }
  if (type === "error") return { phase: "error", label: "Action failed", glyph: "!", tone: "error" }
  if (type === "step-start") return { phase: "working", label: "Working", glyph: "◌", tone: "active" }

  return { phase: "working", label: "Working", glyph: "◌", tone: "active" }
}
