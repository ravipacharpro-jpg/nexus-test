// doctor.ts — read-only project diagnostic agent.
// Per spec: NEVER mutate state, NEVER install, NEVER push, NEVER delete.
// Generates .nexus/doctor-report.md and a structured findings array.

import { existsSync, readFileSync, statSync, readdirSync } from "node:fs"
import { join, relative, basename } from "node:path"
import { execSync } from "node:child_process"
import { log } from "./logger.ts"

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO"
export type Status = "confirmed" | "suspected" | "not-tested" | "blocked"

export interface DoctorFinding {
  severity: Severity
  title: string
  /** file:line reference, or null if global */
  evidence: string | null
  impact: string
  /** command to reproduce/verify, or null */
  repro: string | null
  recommendation: string
  /** whether it is safe to auto-fix without human approval */
  safeToAutoFix: boolean
  status: Status
  category: string
}

export interface DoctorReport {
  generatedAt: string
  repo: string
  version: string | null
  findings: DoctorFinding[]
  /** Total counts by severity */
  summary: {
    critical: number
    high: number
    medium: number
    low: number
    info: number
    total: number
  }
}

/** Redact known secret patterns in any string before it's reported. */
function redactSecrets(s: string): string {
  return s
    .replace(/ghp_[a-zA-Z0-9]{20,}/g, "ghp_***REDACTED***")
    .replace(/sk-[a-zA-Z0-9]{20,}/g, "sk-***REDACTED***")
    .replace(/sk-or-[a-zA-Z0-9]{20,}/g, "sk-or-***REDACTED***")
    .replace(/AIza[a-zA-Z0-9_-]{30,}/g, "AIza***REDACTED***")
    .replace(/password\s*[=:]\s*["']?[^"'\s]+/gi, "password=***REDACTED***")
    .replace(/api[_-]?key\s*[=:]\s*["']?[^"'\s]+/gi, "api_key=***REDACTED***")
}

/** Read VERSION file safely. */
function readVersion(repo: string): string | null {
  const p = join(repo, "VERSION")
  if (!existsSync(p)) return null
  try {
    return readFileSync(p, "utf8").trim()
  } catch {
    return null
  }
}

/** Scan a directory tree (max depth) and return relative file paths. */
function walkDir(dir: string, maxDepth = 4, depth = 0): string[] {
  if (depth > maxDepth) return []
  if (!existsSync(dir)) return []
  const out: string[] = []
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") && e.name !== ".nexus") continue
      if (e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        out.push(...walkDir(full, maxDepth, depth + 1))
      } else if (e.isFile()) {
        out.push(full)
      }
    }
  } catch {
    // permission denied etc.
  }
  return out
}

function addFinding(
  findings: DoctorFinding[],
  f: Omit<DoctorFinding, "category"> & { category: string },
) {
  // Auto-redact evidence and repro to prevent secret leakage
  if (f.evidence) f.evidence = redactSecrets(f.evidence)
  if (f.repro) f.repro = redactSecrets(f.repro)
  findings.push(f)
}

/** Run all doctor checks. Read-only: only reads files & runs `git` read-only
 *  commands (status, log, diff). Never mutates the working tree. */
export function runDoctor(opts: { repo?: string; full?: boolean } = {}): DoctorReport {
  const repo = opts.repo ?? process.cwd()
  const findings: DoctorFinding[] = []
  const version = readVersion(repo)

  // 1. Version + package.json consistency
  if (version) {
    const pkgPath = join(repo, "package.json")
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string }
        if (pkg.version && !version.includes(pkg.version)) {
          addFinding(findings, {
            severity: "MEDIUM",
            title: "VERSION file and package.json disagree",
            evidence: `VERSION=${version}, package.json=${pkg.version}`,
            impact: "Release tooling and users may be confused about the actual version.",
            repro: `cat ${join(repo, "VERSION")} && grep version ${pkgPath}`,
            recommendation: "Keep VERSION and package.json in sync; bump both in the same commit.",
            safeToAutoFix: false,
            status: "confirmed",
            category: "release",
          })
        }
      } catch {
        addFinding(findings, {
          severity: "LOW",
          title: "package.json is not valid JSON",
          evidence: pkgPath,
          impact: "Tooling that reads package.json will fail.",
          repro: `node -e "JSON.parse(require('fs').readFileSync('${pkgPath}','utf8'))"`,
          recommendation: "Run `node -e \"JSON.parse(...)\"` and fix the syntax error.",
          safeToAutoFix: false,
          status: "confirmed",
          category: "build",
        })
      }
    }
  }

  // 2. Git working tree status (read-only)
  try {
    const out = execSync("git status --porcelain", { cwd: repo, encoding: "utf8" })
    const lines = out.split("\n").filter(Boolean)
    if (lines.length > 0) {
      addFinding(findings, {
        severity: "INFO",
        title: `${lines.length} uncommitted change(s)`,
        evidence: lines.slice(0, 3).join("\n"),
        impact: "Local changes exist that are not yet committed.",
        repro: "git status",
        recommendation: "Review and commit or stash as appropriate.",
        safeToAutoFix: false,
        status: "confirmed",
        category: "git",
      })
    }
  } catch {
    addFinding(findings, {
      severity: "LOW",
      title: "Not a git repository (or git unavailable)",
      evidence: repo,
      impact: "Doctor cannot inspect git history.",
      repro: "git status",
      recommendation: "Initialize git if you want full history checks.",
      safeToAutoFix: false,
      status: "blocked",
      category: "git",
    })
  }

  // 3. Secret scan: search for known patterns in source files
  const secretPatterns = [
    { re: /ghp_[a-zA-Z0-9]{20,}/, name: "GitHub personal access token" },
    { re: /sk-[a-zA-Z0-9]{20,}/, name: "OpenAI API key" },
    { re: /sk-or-[a-zA-Z0-9]{20,}/, name: "OpenRouter API key" },
    { re: /AIza[a-zA-Z0-9_-]{30,}/, name: "Google API key" },
  ]
  const srcFiles = walkDir(join(repo, "packages"), 5).filter((f) => {
    if (!/\.(ts|tsx|js|json|jsonc|md|sh|mjs|cjs)$/.test(f)) return false
    // Skip test files: they intentionally contain fake secrets as fixtures.
    if (/(^|\/)test(s|\.ts|\.tsx)?\//.test(f)) return false
    if (/\.test\.(ts|tsx|js|mjs|cjs)$/.test(f)) return false
    if (/\.spec\.(ts|tsx|js|mjs|cjs)$/.test(f)) return false
    return true
  })
  for (const f of srcFiles) {
    let content: string
    try {
      content = readFileSync(f, "utf8")
    } catch {
      continue
    }
    for (const { re, name } of secretPatterns) {
      if (re.test(content)) {
        const rel = relative(repo, f)
        addFinding(findings, {
          severity: "CRITICAL",
          title: `Hardcoded ${name} in source`,
          evidence: `${rel}: ${content.match(re)?.[0].slice(0, 12)}…`,
          impact: "Secret committed to git history. Rotate immediately.",
          repro: `grep -rn '${re.source.slice(0, 8)}' ${rel}`,
          recommendation: "Move to ~/.nexus/api-vault.json, rotate the key, and amend history.",
          safeToAutoFix: false,
          status: "confirmed",
          category: "security",
        })
      }
    }
  }

  // 4. Smoke test presence
  if (!existsSync(join(repo, "scripts", "smoke-test.sh"))) {
    addFinding(findings, {
      severity: "MEDIUM",
      title: "No scripts/smoke-test.sh present",
      evidence: null,
      impact: "Release verification is manual and brittle.",
      repro: "ls scripts/smoke-test.sh",
      recommendation: "Add a smoke-test.sh that exits 0 only when all critical checks pass.",
      safeToAutoFix: false,
      status: "confirmed",
      category: "testing",
    })
  }

  // 5. CHANGELOG presence
  if (!existsSync(join(repo, "CHANGELOG.md"))) {
    addFinding(findings, {
      severity: "LOW",
      title: "No CHANGELOG.md",
      evidence: null,
      impact: "Users and contributors have no upgrade history.",
      repro: "ls CHANGELOG.md",
      recommendation: "Add a CHANGELOG.md following Keep-a-Changelog format.",
      safeToAutoFix: false,
      status: "confirmed",
      category: "docs",
    })
  }

  // 6. Bun test infra (best-effort — Termux often has missing deps)
  try {
    execSync("bun test --version", { cwd: repo, encoding: "utf8", stdio: "pipe" })
  } catch {
    addFinding(findings, {
      severity: "INFO",
      title: "bun test not runnable in this environment",
      evidence: "bun test --version failed",
      impact: "Automated tests cannot execute; rely on smoke-test.sh.",
      repro: "bun test --version",
      recommendation: "Either fix deps or maintain a shell-based smoke check.",
      safeToAutoFix: false,
      status: "not-tested",
      category: "testing",
    })
  }

  // Full mode adds deeper checks
  if (opts.full) {
    // 7. TODO/FIXME count
    let todos = 0
    for (const f of srcFiles) {
      try {
        const c = readFileSync(f, "utf8")
        todos += (c.match(/\bTODO\b/g) ?? []).length
        todos += (c.match(/\bFIXME\b/g) ?? []).length
      } catch {
        // ignore
      }
    }
    if (todos > 0) {
      addFinding(findings, {
        severity: "LOW",
        title: `${todos} TODO/FIXME comment(s) in source`,
        evidence: null,
        impact: "Pending work tracked in code rather than issues.",
        repro: "grep -rn 'TODO\\|FIXME' packages/ | wc -l",
        recommendation: "Convert to issues or address in upcoming commits.",
        safeToAutoFix: false,
        status: "confirmed",
        category: "code-hygiene",
      })
    }
  }

  // Build summary
  const summary = {
    critical: findings.filter((f) => f.severity === "CRITICAL").length,
    high: findings.filter((f) => f.severity === "HIGH").length,
    medium: findings.filter((f) => f.severity === "MEDIUM").length,
    low: findings.filter((f) => f.severity === "LOW").length,
    info: findings.filter((f) => f.severity === "INFO").length,
    total: findings.length,
  }

  return {
    generatedAt: new Date().toISOString(),
    repo,
    version,
    findings: findings.sort((a, b) => {
      const order: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 }
      return order[a.severity] - order[b.severity]
    }),
    summary,
  }
}

/** Render a DoctorReport as Markdown. */
export function renderDoctorMarkdown(r: DoctorReport): string {
  const lines: string[] = []
  lines.push(`# Doctor Report`)
  lines.push("")
  lines.push(`- **Generated**: ${r.generatedAt}`)
  lines.push(`- **Repo**: \`${r.repo}\``)
  lines.push(`- **Version**: ${r.version ?? "(unknown)"}`)
  lines.push("")
  lines.push(`## Summary`)
  lines.push("")
  lines.push(`| Severity | Count |`)
  lines.push(`|----------|------:|`)
  lines.push(`| CRITICAL | ${r.summary.critical} |`)
  lines.push(`| HIGH     | ${r.summary.high} |`)
  lines.push(`| MEDIUM   | ${r.summary.medium} |`)
  lines.push(`| LOW      | ${r.summary.low} |`)
  lines.push(`| INFO     | ${r.summary.info} |`)
  lines.push(`| **Total**| **${r.summary.total}** |`)
  lines.push("")
  if (r.findings.length === 0) {
    lines.push(`> No issues found. ✓`)
  } else {
    lines.push(`## Findings`)
    lines.push("")
    for (const f of r.findings) {
      lines.push(`### [${f.severity}] ${f.title}`)
      lines.push("")
      lines.push(`- **Category**: ${f.category}`)
      lines.push(`- **Status**: ${f.status}`)
      lines.push(`- **Impact**: ${f.impact}`)
      if (f.evidence) {
        lines.push(`- **Evidence**: \`${f.evidence.replace(/`/g, "\\`")}\``)
      }
      if (f.repro) {
        lines.push(`- **Reproduce**: \`${f.repro.replace(/`/g, "\\`")}\``)
      }
      lines.push(`- **Recommendation**: ${f.recommendation}`)
      lines.push(`- **Auto-fix safe**: ${f.safeToAutoFix ? "yes" : "no"}`)
      lines.push("")
    }
  }
  lines.push(`---`)
  lines.push(`*Doctor is read-only. No files were modified, no packages installed, no commits made.*`)
  return lines.join("\n")
}
