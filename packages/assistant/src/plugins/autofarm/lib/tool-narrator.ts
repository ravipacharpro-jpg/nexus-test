// tool-narrator: turn raw tool calls into human-readable one-liners.
// No emojis per the project rule — only ASCII / geometric icons.
// Output is consumed by the agent's reply renderer (TUI untouched).

export type ToolName =
  | "bash" | "read" | "write" | "edit" | "glob" | "grep"
  | "webfetch" | "websearch" | "task" | "todowrite" | "skill"
  | "question" | "patch" | "unknown"

const ICON: Record<ToolName, string> = {
  bash: "$",        // shell
  read: ">>",       // open file
  write: "++",      // create
  edit: "~",        // modify
  glob: "**",       // pattern
  grep: "?",        // search
  webfetch: "@@",   // web read
  websearch: "??",  // web search
  task: ">>",       // subagent
  todowrite: "[]",  // plan
  skill: "{}",      // plugin
  question: "??",   // ask
  patch: "++~",     // git apply
  unknown: "...",
}

export interface ToolCall {
  tool: ToolName
  /** raw args from the model */
  args: Record<string, unknown>
  /** tool output (truncated) */
  preview?: string
  /** wall time ms */
  durationMs?: number
  /** ok | fail | cancelled */
  status?: "ok" | "fail" | "cancelled"
}

export interface NarratedLine {
  /** Single-line summary (e.g. "$ npm test (exit 0, 1.2s)"). */
  text: string
  /** Secondary line, may be omitted by renderer. */
  detail?: string
  /** Severity: 0=info, 1=ok, 2=warn, 3=err. */
  level: 0 | 1 | 2 | 3
}

function pick<T>(o: Record<string, unknown>, k: string, d: T): T {
  return (o[k] as T) ?? d
}

function trim(s: string, max = 80): string {
  if (!s) return ""
  s = s.replace(/\s+/g, " ").trim()
  return s.length > max ? s.slice(0, max - 1) + "…" : s
}

function lineCount(s: string): number {
  if (!s) return 0
  return s.split("\n").length
}

function byteCount(s: string): number {
  return s ? s.length : 0
}

/** Detect a tool name from a generic call record. */
export function detectTool(name?: string): ToolName {
  if (!name) return "unknown"
  const n = name.toLowerCase()
  if (n.includes("bash") || n.includes("shell") || n.includes("exec")) return "bash"
  if (n.includes("read")) return "read"
  if (n.includes("write") && !n.includes("edit")) return "write"
  if (n.includes("edit") || n.includes("patch") || n.includes("multiedit")) return "edit"
  if (n.includes("glob") || n.includes("list")) return "glob"
  if (n.includes("grep") || n.includes("search")) return "grep"
  if (n.includes("fetch") || n.includes("web")) return "webfetch"
  if (n.includes("task") || n.includes("agent")) return "task"
  if (n.includes("todo")) return "todowrite"
  if (n.includes("skill") || n.includes("plugin")) return "skill"
  if (n.includes("question") || n.includes("ask")) return "question"
  return "unknown"
}

/** Narrate a tool call. Returns a one-liner + optional detail. */
export function narrate(call: ToolCall): NarratedLine {
  const t = call.tool
  const icon = ICON[t]
  const status = call.status ?? "ok"
  const dur = call.durationMs != null ? ` (${(call.durationMs / 1000).toFixed(1)}s)` : ""

  switch (t) {
    case "bash": {
      const cmd = trim(String(pick(call.args, "command", pick(call.args, "cmd", ""))), 100)
      const text = `${icon} ${cmd}${dur}`
      const exit = pick(call.args, "exitCode", undefined as unknown)
      let level: NarratedLine["level"] = status === "fail" ? 3 : status === "ok" ? 1 : 0
      let detail: string | undefined
      if (call.preview) {
        const lines = lineCount(call.preview)
        const bytes = byteCount(call.preview)
        detail = `${lines} line(s), ${bytes} byte(s) output`
        if (lines > 15) level = 2 // long output warning
      }
      if (exit !== undefined && Number(exit) !== 0) {
        level = 3
        detail = `exit ${exit}` + (detail ? `, ${detail}` : "")
      }
      return { text, level, ...(detail ? { detail } : {}) }
    }
    case "read": {
      const file = String(pick(call.args, "filePath", pick(call.args, "path", "")))
      const text = `${icon} ${file || "(unknown file)"}${dur}`
      let detail: string | undefined
      if (call.preview) {
        const lines = lineCount(call.preview)
        detail = `${lines} line(s) read`
      }
      return { text, level: 0, ...(detail ? { detail } : {}) }
    }
    case "write": {
      const file = String(pick(call.args, "filePath", pick(call.args, "path", "")))
      const content = String(pick(call.args, "content", ""))
      const lines = lineCount(content)
      const text = `${icon} ${file || "(new file)"} (${lines} line(s))${dur}`
      return { text, level: status === "fail" ? 3 : 1 }
    }
    case "edit": {
      const file = String(pick(call.args, "filePath", pick(call.args, "path", "")))
      const oldText = String(pick(call.args, "oldString", ""))
      const newText = String(pick(call.args, "newString", ""))
      const oldLines = lineCount(oldText)
      const newLines = lineCount(newText)
      const text = `${icon} ${file || "(edit)"} (-${oldLines}/+${newLines})${dur}`
      let level: NarratedLine["level"] = 0
      if (oldLines === 0 && newLines > 0) level = 1
      else if (oldLines > 0 && newLines === 0) level = 2
      else level = 0
      return { text, level }
    }
    case "glob": {
      const pattern = String(pick(call.args, "pattern", pick(call.args, "glob", "")))
      const text = `${icon} ${pattern || "(glob)"}${dur}`
      let detail: string | undefined
      if (call.preview) {
        const matches = call.preview.split("\n").filter(Boolean).length
        detail = `${matches} match(es)`
      }
      return { text, level: 0, ...(detail ? { detail } : {}) }
    }
    case "grep": {
      const pattern = String(pick(call.args, "pattern", ""))
      const path = String(pick(call.args, "path", ""))
      const text = `${icon} /${pattern}/${path ? ` in ${path}` : ""}${dur}`
      let detail: string | undefined
      if (call.preview) {
        const matches = call.preview.split("\n").filter(Boolean).length
        detail = `${matches} match(es)`
      }
      return { text, level: 0, ...(detail ? { detail } : {}) }
    }
    case "webfetch": {
      const url = String(pick(call.args, "url", ""))
      const text = `${icon} ${trim(url, 60)}${dur}`
      let detail: string | undefined
      if (call.preview) detail = `${byteCount(call.preview)} byte(s) fetched`
      return { text, level: 0, ...(detail ? { detail } : {}) }
    }
    case "websearch": {
      const q = String(pick(call.args, "query", pick(call.args, "q", "")))
      const text = `${icon} "${trim(q, 60)}"${dur}`
      let detail: string | undefined
      if (call.preview) detail = `${call.preview.split("\n").filter(Boolean).length} result(s)`
      return { text, level: 0, ...(detail ? { detail } : {}) }
    }
    case "task": {
      const desc = String(pick(call.args, "description", pick(call.args, "prompt", "")))
      const text = `${icon} ${trim(desc, 80)}${dur}`
      return { text, level: 1 }
    }
    case "todowrite": {
      const items = (pick(call.args, "items", []) as unknown[]) || []
      const text = `${icon} plan (${items.length} step(s))${dur}`
      return { text, level: 0 }
    }
    case "skill": {
      const name = String(pick(call.args, "name", ""))
      const text = `${icon} ${name || "(skill)"}${dur}`
      return { text, level: 0 }
    }
    case "question": {
      const q = String(pick(call.args, "question", ""))
      const text = `${icon} ${trim(q, 80)}`
      return { text, level: 0 }
    }
    default: {
      const text = `${icon} ${trim(JSON.stringify(call.args), 60)}${dur}`
      return { text, level: status === "fail" ? 3 : 0 }
    }
  }
}

/** Format narrated line as ASCII-only one-liner (no emoji). */
export function format(n: NarratedLine): string {
  const lvl = n.level === 1 ? "[OK]" : n.level === 2 ? "[WARN]" : n.level === 3 ? "[ERR]" : "[..]"
  const detail = n.detail ? ` — ${n.detail}` : ""
  return `${lvl} ${n.text}${detail}`
}
