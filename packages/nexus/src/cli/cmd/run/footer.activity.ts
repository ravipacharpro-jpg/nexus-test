export type FooterActivityTone = "active" | "warning" | "error" | "muted"

export type FooterActivity = {
  glyph: string
  label: string
  tone: FooterActivityTone
  pulse: boolean
}

export function deriveFooterActivity(input: {
  busy: boolean
  exiting: boolean
  armed: boolean
  status: string
  completed?: boolean
}): FooterActivity | undefined {
  if (input.exiting) return { glyph: "!", label: "Exiting", tone: "error", pulse: false }
  if (input.armed) return { glyph: "‖", label: "Interrupt ready", tone: "warning", pulse: true }

  const status = input.status.toLowerCase()
  if (status.includes("retry") || status.includes("fallback")) {
    return { glyph: "↻", label: "Retrying route", tone: "warning", pulse: true }
  }
  if (status.includes("permission") || status.includes("approval") || status.includes("question")) {
    return { glyph: "‖", label: "Waiting for approval", tone: "warning", pulse: false }
  }
  if (/(wait|hold|queued)/.test(status)) return { glyph: "…", label: "Waiting", tone: "muted", pulse: false }
  if (/(error|failed|failure)/.test(status)) return { glyph: "!", label: "Needs attention", tone: "error", pulse: false }
  if (input.completed) return { glyph: "✓", label: "Completed", tone: "muted", pulse: false }
  if (!input.busy) return
  if (status.includes("test")) return { glyph: "✓", label: "Testing", tone: "active", pulse: true }
  if (/(reason|think|plan)/.test(status)) return { glyph: "◌", label: "Reasoning", tone: "active", pulse: true }
  if (/(read|grep|glob|search|scan|list|find)/.test(status)) {
    return { glyph: "⌕", label: "Reading", tone: "active", pulse: true }
  }
  if (/(write|edit|patch|apply|create)/.test(status)) {
    return { glyph: "✎", label: "Writing", tone: "active", pulse: true }
  }
  if (/(delet|remove|unlink)/.test(status)) return { glyph: "!", label: "Deleting", tone: "warning", pulse: false }
  if (/(upload|push)/.test(status)) return { glyph: "↑", label: "Uploading", tone: "active", pulse: true }
  if (/(download|pull|fetch)/.test(status)) return { glyph: "↓", label: "Downloading", tone: "active", pulse: true }
  return { glyph: "◌", label: "Working", tone: "active", pulse: true }
}
