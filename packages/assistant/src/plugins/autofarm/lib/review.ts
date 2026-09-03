// review.ts — read-only code/diff review agent.
// Per spec: NEVER commit, push, or modify files. Only inspects.

import { execSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"

export type Verdict = "APPROVE" | "APPROVE-WITH-WARNINGS" | "REQUEST-CHANGES" | "BLOCKED"

export interface ReviewFinding {
  category: "correctness" | "regression" | "security" | "secrets" | "error-handling" | "tests" | "performance" | "compat" | "maintainability" | "docs"
  severity: "blocking" | "major" | "minor" | "nit"
  title: string
  file: string
  /** line or symbol reference (best-effort) */
  line: string | null
  evidence: string
  impact: string
  fix: string
}

export interface ReviewReport {
  generatedAt: string
  source: "uncommitted" | "branch" | "commit" | "patch"
  /** short summary of what changed */
  summary: string
  changedFiles: string[]
  findings: ReviewFinding[]
  /** blocker count; >0 means verdict is at minimum REQUEST-CHANGES */
  blockingCount: number
  majorCount: number
  minorCount: number
  verdict: Verdict
}

const SECRET_PATTERNS = [
  { re: /ghp_[a-zA-Z0-9]{20,}/g, name: "GitHub PAT" },
  { re: /sk-[a-zA-Z0-9]{20,}/g, name: "OpenAI key" },
  { re: /sk-or-[a-zA-Z0-9]{20,}/g, name: "OpenRouter key" },
  { re: /AIza[a-zA-Z0-9_-]{30,}/g, name: "Google API key" },
]

const DANGEROUS_PATTERNS: Array<{ re: RegExp; title: string; severity: ReviewFinding["severity"]; impact: string; fix: string }> = [
  { re: /eval\s*\(/g, title: "Use of eval()", severity: "blocking", impact: "Code-injection risk.", fix: "Replace with a parser or a lookup table." },
  { re: /child_process\.(exec|execSync)\s*\(/g, title: "child_process.exec used", severity: "major", impact: "Shell injection if input is untrusted.", fix: "Use execFile with an argv array, or sanitize input." },
  { re: /fs\.rmSync\s*\([^)]*\{[^}]*recursive\s*:\s*true[^}]*\}/g, title: "Recursive fs.rm", severity: "major", impact: "Can wipe large trees.", fix: "Confirm path and add a dry-run option." },
  { re: /process\.env\.[A-Z_]+\s*\|\|\s*['"]/g, title: "Hardcoded fallback for env var", severity: "minor", impact: "Hidden default may mask missing config.", fix: "Throw if env var is missing instead." },
  { re: /\bany\b/g, title: "TypeScript `any`", severity: "nit", impact: "Loses type safety.", fix: "Use a specific type or `unknown`." },
]

function decideVerdict(blocking: number, major: number, minor: number): Verdict {
  if (blocking > 0) return "BLOCKED"
  if (major > 2) return "REQUEST-CHANGES"
  if (major > 0 || minor > 5) return "APPROVE-WITH-WARNINGS"
  return "APPROVE"
}

/** Run a review of the current working tree's uncommitted changes.
 *  Read-only: only `git diff` and `git status` are invoked. */
export function reviewUncommitted(cwd: string = process.cwd()): ReviewReport {
  let diff = ""
  let summary = "(no changes)"
  try {
    const status = execSync("git status --porcelain", { cwd, encoding: "utf8" })
    if (!status.trim()) {
      return {
        generatedAt: new Date().toISOString(),
        source: "uncommitted",
        summary: "Working tree clean — nothing to review.",
        changedFiles: [],
        findings: [],
        blockingCount: 0,
        majorCount: 0,
        minorCount: 0,
        verdict: "APPROVE",
      }
    }
    diff = execSync("git diff", { cwd, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 })
    const files = status.split("\n").filter(Boolean).map((l) => l.slice(3).trim().split(" ").pop() ?? "")
    summary = `${files.length} file(s) changed in working tree`
    return reviewPatch(diff, summary, files)
  } catch (e) {
    return {
      generatedAt: new Date().toISOString(),
      source: "uncommitted",
      summary: `git error: ${(e as Error).message}`,
      changedFiles: [],
      findings: [],
      blockingCount: 0,
      majorCount: 0,
      minorCount: 0,
      verdict: "BLOCKED",
    }
  }
}

/** Review an arbitrary patch (unified diff text). */
export function reviewPatch(patch: string, summary = "(patch)", files: string[] = []): ReviewReport {
  const findings: ReviewFinding[] = []
  const lines = patch.split("\n")
  const seenFiles = new Set<string>()
  let currentFile = "(unknown)"

  for (const ln of lines) {
    if (ln.startsWith("diff --git ")) {
      const m = ln.match(/b\/(.+)$/)
      if (m) {
        currentFile = m[1]
        seenFiles.add(currentFile)
      }
      continue
    }
    if (!ln.startsWith("+") || ln.startsWith("+++")) continue
    const added = ln.slice(1)

    // secret scan
    for (const { re, name } of SECRET_PATTERNS) {
      if (re.test(added)) {
        findings.push({
          category: "secrets",
          severity: "blocking",
          title: `${name} found in diff`,
          file: currentFile,
          line: null,
          evidence: added.replace(re, "***REDACTED***").slice(0, 120),
          impact: "Secret will be pushed to remote.",
          fix: "Move to ~/.nexus/api-vault.json and amend the commit before pushing.",
        })
      }
    }
    // dangerous patterns
    for (const p of DANGEROUS_PATTERNS) {
      if (p.re.test(added)) {
        findings.push({
          category: "security",
          severity: p.severity,
          title: p.title,
          file: currentFile,
          line: null,
          evidence: added.slice(0, 120),
          impact: p.impact,
          fix: p.fix,
        })
      }
    }
    // simple console.log
    if (/^\s*console\.log\(/.test(added) && !/\.test\.|test\//.test(currentFile)) {
      findings.push({
        category: "maintainability",
        severity: "nit",
        title: "console.log left in code",
        file: currentFile,
        line: null,
        evidence: added.slice(0, 100),
        impact: "Noise in production output.",
        fix: "Remove or replace with the logger.",
      })
    }
  }

  const blocking = findings.filter((f) => f.severity === "blocking").length
  const major = findings.filter((f) => f.severity === "major").length
  const minor = findings.filter((f) => f.severity === "minor" || f.severity === "nit").length
  const verdict = decideVerdict(blocking, major, minor)

  return {
    generatedAt: new Date().toISOString(),
    source: "patch",
    summary,
    changedFiles: files.length > 0 ? files : Array.from(seenFiles),
    findings: findings.sort((a, b) => {
      const order: Record<ReviewFinding["severity"], number> = { blocking: 0, major: 1, minor: 2, nit: 3 }
      return order[a.severity] - order[b.severity]
    }),
    blockingCount: blocking,
    majorCount: major,
    minorCount: minor,
    verdict,
  }
}

export function renderReviewMarkdown(r: ReviewReport): string {
  const lines: string[] = []
  lines.push(`# Code Review`)
  lines.push("")
  lines.push(`- **Generated**: ${r.generatedAt}`)
  lines.push(`- **Source**: ${r.source}`)
  lines.push(`- **Summary**: ${r.summary}`)
  lines.push(`- **Files changed**: ${r.changedFiles.length}`)
  lines.push(`- **Verdict**: **${r.verdict}**`)
  lines.push("")
  lines.push(`## Counts`)
  lines.push("")
  lines.push(`- Blocking: ${r.blockingCount}`)
  lines.push(`- Major:    ${r.majorCount}`)
  lines.push(`- Minor+Nit: ${r.minorCount}`)
  lines.push("")
  if (r.changedFiles.length > 0) {
    lines.push(`## Files`)
    lines.push("")
    for (const f of r.changedFiles) lines.push(`- \`${f}\``)
    lines.push("")
  }
  if (r.findings.length === 0) {
    lines.push(`> No issues found. ✓`)
  } else {
    lines.push(`## Findings`)
    lines.push("")
    for (const f of r.findings) {
      lines.push(`### [${f.severity.toUpperCase()}] ${f.title}`)
      lines.push("")
      lines.push(`- **Category**: ${f.category}`)
      lines.push(`- **File**: \`${f.file}\``)
      if (f.line) lines.push(`- **Line**: ${f.line}`)
      lines.push(`- **Evidence**: \`${f.evidence.replace(/`/g, "\\`")}\``)
      lines.push(`- **Impact**: ${f.impact}`)
      lines.push(`- **Suggested fix**: ${f.fix}`)
      lines.push("")
    }
  }
  lines.push(`---`)
  lines.push(`*Review is read-only. No commits, pushes, or file changes were made.*`)
  return lines.join("\n")
}
