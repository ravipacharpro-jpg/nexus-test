// edit-summary: a file diff is collapsed into a 1-line summary
// (file: +/- N lines, ~ N lines, key symbols touched).
// No emojis. Returns structured data so the agent can decide
// whether to inline the diff or just show the summary.

export interface DiffStats {
  file: string
  added: number
  removed: number
  /** Symbols (function/class names) that appear in the new content. */
  touchedSymbols: string[]
  /** Sample of the largest single hunk. */
  largestHunk?: { oldStart: number; newStart: number; lines: number }
}

export interface EditSummary {
  text: string              // one-liner
  detail: string            // 1-3 line breakdown
  diff: string              // raw diff (caller decides whether to show)
  stats: DiffStats
  /** Severity: 0=info, 1=ok, 2=warn, 3=err. */
  level: 0 | 1 | 2 | 3
}

const ICON_FILE = "++~"

/** Build a small diff for two strings. Not a real diff engine —
 *  just enough to count +/- and grab symbol names. */
function simpleDiff(oldStr: string, newStr: string): { added: number; removed: number; hunks: Array<{ oldStart: number; newStart: number; lines: number }> } {
  const oldLines = oldStr.split("\n")
  const newLines = newStr.split("\n")
  const oldSet = new Set(oldLines)
  const newSet = new Set(newLines)
  let added = 0
  for (const l of newLines) if (!oldSet.has(l)) added++
  let removed = 0
  for (const l of oldLines) if (!newSet.has(l)) removed++
  return { added, removed, hunks: [{ oldStart: 1, newStart: 1, lines: added + removed }] }
}

/** Extract function/class/method names from a piece of code. */
export function extractSymbols(text: string): string[] {
  if (!text) return []
  const out = new Set<string>()
  const re = /(?:function|class|const|let|var|interface|type|def|fn|public|private|protected|static)\s+([A-Za-z_$][\w$]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.add(m[1])
  // method-style: `name(...)` or `name<T>(` after a dot
  const re2 = /\.([A-Za-z_$][\w$]*)\s*[<(=]/g
  while ((m = re2.exec(text)) !== null) out.add(m[1])
  return [...out].slice(0, 8)
}

/** Summarize an edit. */
export function summarizeEdit(file: string, oldStr: string, newStr: string): EditSummary {
  const d = simpleDiff(oldStr, newStr)
  const syms = extractSymbols(newStr)
  const stats: DiffStats = {
    file,
    added: d.added,
    removed: d.removed,
    touchedSymbols: syms,
    ...(d.hunks[0] ? { largestHunk: d.hunks[0] } : {}),
  }
  const text = `${ICON_FILE} ${file} (-${d.removed}/+${d.added})`
  const detail = syms.length > 0
    ? `touched: ${syms.slice(0, 4).join(", ")}${syms.length > 4 ? "…" : ""}`
    : "no symbols detected"
  let level: 0 | 1 | 2 | 3 = 0
  if (d.added > 0 && d.removed === 0) level = 1
  else if (d.removed > 0 && d.added === 0) level = 2
  else if (d.added > 200 || d.removed > 200) level = 2
  const diff = makeUnifiedDiff(file, oldStr, newStr)
  return { text, detail, diff, stats, level }
}

/** Build a tiny unified-diff-ish string. Real engine later if needed. */
function makeUnifiedDiff(file: string, oldStr: string, newStr: string): string {
  if (!oldStr && !newStr) return ""
  const oldLines = oldStr.split("\n")
  const newLines = newStr.split("\n")
  const max = Math.max(oldLines.length, newLines.length)
  const out: string[] = [`--- a/${file}`, `+++ b/${file}`, "@@ -1 +1 @@"]
  for (let i = 0; i < max; i++) {
    if (i < oldLines.length && !newLines.includes(oldLines[i])) out.push(`-${oldLines[i]}`)
    if (i < newLines.length && !oldLines.includes(newLines[i])) out.push(`+${newLines[i]}`)
  }
  return out.join("\n")
}

/** Format a summary for display (no emoji, ASCII icons). */
export function formatEditSummary(s: EditSummary, opts: { showDiff?: boolean } = {}): string {
  const lvl = s.level === 1 ? "[OK]" : s.level === 2 ? "[WARN]" : s.level === 3 ? "[ERR]" : "[..]"
  let out = `${lvl} ${s.text} — ${s.detail}`
  if (opts.showDiff && s.diff) out += `\n${s.diff}`
  return out
}
