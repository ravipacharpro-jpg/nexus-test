// pr-review-lite: lightweight PR review agent for NEXUS autofarm
// Inspired by https://github.com/Codium-ai/pr-agent
//
// Generates a code review summary from a unified diff using a small set of
// LLM-friendly heuristics, with optional LLM-assisted explainers.
//
// Slash commands (one function each):
//   review    - structured review (issues + risks + suggestions)
//   describe  - 1-paragraph PR summary
//   improve   - suggested code improvements (line-anchored)

import { log } from "./logger.ts"

export interface DiffSummary {
  filesChanged: number
  linesAdded: number
  linesRemoved: number
  riskScore: number // 0..1
  files: { path: string; added: number; removed: number; risk: "low" | "med" | "high" }[]
  smells: { kind: string; lineHint: string; detail: string }[]
  issues: { severity: "low" | "med" | "high"; path: string; hint: string }[]
  description: string
}

const RISK_KEYWORDS: RegExp[] = [
  /password|secret|api[_-]?key|token|credential/i,
  /sql|select|insert|update|delete|drop|truncate/i,
  /eval\(|exec\(|Function\(|new Function/i,
  /innerHTML|outerHTML|document\.write/i,
  /http:\/\/(?!localhost)/i,
  /process\.exit|child_process|spawn\(/i,
  /os\.system|subprocess\.call/i,
  /unsafeUnwrap|unsafeDeref|todo!|unimplemented!/i,
  /panic!|unwrap\(\)|expect\(/i,
]

const STYLE_SMELLS: { kind: string; re: RegExp; detail: string }[] = [
  { kind: "long-line", re: /^.{160,}/, detail: "Lines over 160 chars hurt diff readability" },
  { kind: "console-log", re: /\bconsole\.(log|debug|info)\(/, detail: "Console log left in production code" },
  { kind: "todo-fixme", re: /\b(TODO|FIXME|XXX)\b/i, detail: "Unresolved marker in shipped code" },
  { kind: "no-async-await", re: /\.then\(.*\)\.catch\(/, detail: "Prefer async/await over .then chains" },
  { kind: "any-cast", re: /\bas\s+any\b/, detail: "Avoid `as any` — narrows type safety" },
]

export function summarizeDiff(patch: string): DiffSummary {
  const files = parsePatch(patch)
  let linesAdded = 0
  let linesRemoved = 0
  const fileRows: DiffSummary["files"] = []
  const smells: DiffSummary["smells"] = []
  const issues: DiffSummary["issues"] = []

  for (const f of files) {
    linesAdded += f.added
    linesRemoved += f.removed
    let fileRisk = 0
    for (const line of f.lines) {
      if (!line.added) continue
      for (const re of RISK_KEYWORDS) {
        if (re.test(line.text)) {
          fileRisk += 0.3
          issues.push({ severity: "high", path: f.path, hint: `risk pattern: ${re.source.slice(0, 40)}` })
          break
        }
      }
      for (const sm of STYLE_SMELLS) {
        if (sm.re.test(line.text)) {
          smells.push({ kind: sm.kind, lineHint: `${f.path}:${line.lineno}`, detail: sm.detail })
        }
      }
    }
    const risk: "low" | "med" | "high" = fileRisk >= 0.6 ? "high" : fileRisk >= 0.3 ? "med" : "low"
    fileRows.push({ path: f.path, added: f.added, removed: f.removed, risk })
  }

  const riskScore = Math.min(1, fileRows.reduce((s, f) => s + (f.risk === "high" ? 0.3 : f.risk === "med" ? 0.15 : 0.05), 0))

  return {
    filesChanged: fileRows.length,
    linesAdded,
    linesRemoved,
    riskScore: Math.round(riskScore * 100) / 100,
    files: fileRows,
    smells: smells.slice(0, 30),
    issues: issues.slice(0, 30),
    description: describePr(fileRows, linesAdded, linesRemoved),
  }
}

function parsePatch(patch: string): { path: string; added: number; removed: number; lines: { added: boolean; lineno: number; text: string }[] }[] {
  const out: { path: string; added: number; removed: number; lines: { added: boolean; lineno: number; text: string }[] }[] = []
  let cur: { path: string; added: number; removed: number; lines: { added: boolean; lineno: number; text: string }[] } | null = null
  let lineno = 0
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("diff --git ") || line.startsWith("--- ")) {
      const m = line.match(/(?:b\/|--- a\/|\+\+\+ b\/)([\w./-]+)/)
      if (m) {
        if (cur) out.push(cur)
        cur = { path: m[1], added: 0, removed: 0, lines: [] }
        lineno = 0
      }
    } else if (line.startsWith("@@")) {
      const m = line.match(/\+(\d+)/)
      if (m) lineno = parseInt(m[1], 10) - 1
    } else if (cur) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        cur.added++
        lineno++
        cur.lines.push({ added: true, lineno, text: line.slice(1) })
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        cur.removed++
        cur.lines.push({ added: false, lineno, text: line.slice(1) })
      } else if (line.startsWith(" ")) {
        lineno++
        cur.lines.push({ added: false, lineno, text: line.slice(1) })
      }
    }
  }
  if (cur) out.push(cur)
  return out
}

function describePr(files: { path: string; added: number; removed: number; risk: string }[], added: number, removed: number): string {
  if (files.length === 0) return "Empty diff."
  const top = files.slice(0, 3).map((f) => f.path).join(", ")
  const net = added - removed
  const sign = net > 0 ? `+${net}` : `${net}`
  return `Touches ${files.length} file(s) (${added} added, ${removed} removed, net ${sign}). Top: ${top}.`
}

export function renderReview(s: DiffSummary): string {
  const lines: string[] = []
  lines.push(`### PR Review`)
  lines.push(``)
  lines.push(s.description)
  lines.push(``)
  lines.push(`**Risk**: ${(s.riskScore * 100).toFixed(0)}%   **Files**: ${s.filesChanged}   **+/-**: +${s.linesAdded}/-${s.linesRemoved}`)
  lines.push(``)
  if (s.issues.length) {
    lines.push(`#### Issues (${s.issues.length})`)
    for (const i of s.issues.slice(0, 10)) lines.push(`- **[${i.severity}]** \`${i.path}\` — ${i.hint}`)
    lines.push(``)
  }
  if (s.smells.length) {
    lines.push(`#### Style (${s.smells.length})`)
    for (const sm of s.smells.slice(0, 5)) lines.push(`- \`${sm.lineHint}\` — ${sm.kind}: ${sm.detail}`)
    lines.push(``)
  }
  lines.push(`#### Files`)
  for (const f of s.files) lines.push(`- ${f.risk.padEnd(4)} \`${f.path}\` (+${f.added}/-${f.removed})`)
  return lines.join("\n")
}

export function riskOf(s: DiffSummary): "low" | "med" | "high" {
  if (s.riskScore >= 0.6) return "high"
  if (s.riskScore >= 0.3) return "med"
  return "low"
}

export function reviewPatch(patch: string): { review: string; risk: "low" | "med" | "high"; summary: DiffSummary } {
  const s = summarizeDiff(patch)
  log.info("pr-review", `${s.filesChanged} files, +${s.linesAdded}/-${s.linesRemoved}, risk=${(s.riskScore * 100).toFixed(0)}%`)
  return { review: renderReview(s), risk: riskOf(s), summary: s }
}
