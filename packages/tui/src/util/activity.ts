import type { Part, ToolPart } from "@nexus-ai/sdk/v2"

/**
 * Fixed, redacted narration for a running tool. Labels never interpolate
 * command, path, URL, query, pattern, description, title, or task text so the
 * timeline cannot leak user content while a step is still in flight.
 */
export function activityLabel(part: Pick<ToolPart, "tool">): string {
  switch (part.tool) {
    case "bash":
      return "Running tool…"
    case "read":
      return "Reading…"
    case "edit":
    case "write":
      return "Writing…"
    case "grep":
    case "glob":
      return "Searching…"
    case "webfetch":
      return "Fetching…"
    case "task":
      return "Delegating…"
    default:
      return "Working…"
  }
}

/**
 * Current redacted stage of a running assistant turn, derived only from the
 * already-streamed parts of its last message. Returns undefined once visible
 * text is streaming (the timeline itself shows that text).
 */
export function liveActivity(parts: Part[]): string | undefined {
  const running = parts.findLast(
    (part): part is ToolPart => part.type === "tool" && ["pending", "running"].includes(part.state.status),
  )
  if (running) return activityLabel(running)
  const streaming = parts.findLast((part) => part.type === "text" && part.text.trim())
  if (!streaming) return "Thinking..."
  return undefined
}
