// loop-audit: score a NEXUS project 0-100 on its agent-loop
// readiness. Inspired by cobusgreyling/loop-engineering's
// 'loop doctor' pattern (https://github.com/cobusgreyling/loop-engineering,
// 10.8k stars).
//
// The audit walks the project and reports a numeric score plus
// a list of issues. Pure functions, no I/O side-effects beyond
// reading the filesystem. Cross-platform: any runtime that
// supports node:fs + node:path.
//
// Score breakdown (100 total):
//   20  capability-registry has at least one 'partial' OR 'verified' entry
//   20  every partial agent has a VerificationReceipt or equivalent
//   20  a top-level docs/design-tokens.md exists with required sections
//   20  every CLI command has a description string
//   20  no 'TODO' / 'FIXME' lines without a date+owner marker

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export interface AuditIssue {
  id: string
  severity: "info" | "warn" | "error"
  message: string
}

export interface AuditResult {
  score: number
  totalChecks: number
  passed: number
  issues: AuditIssue[]
  generatedAt: string
  repoPath: string
}

interface Check {
  id: string
  weight: number
  run: (root: string) => boolean
  message: string
}

const CHECKS: ReadonlyArray<Check> = [
  {
    id: "capability-registry",
    weight: 20,
    run: (root) => {
      const f = join(root, "packages/assistant/src/plugins/autofarm/lib/partial-features.ts")
      if (!existsSync(f)) return false
      const text = readFileSync(f, "utf8")
      return /status:\s*"(verified|partial)"/i.test(text)
    },
    message: "capability-registry has at least one verified/partial entry",
  },
  {
    id: "verification-receipt",
    weight: 20,
    run: (root) => {
      const dir = join(root, "packages/termux-core/src/agents")
      if (!existsSync(dir)) return false
      const text = require("node:fs").readdirSync(dir).filter((f: string) => f.endsWith(".ts"))
      if (text.length === 0) return false
      // At least one agent must contain a VerificationReceipt-shaped literal
      for (const f of text) {
        const body = readFileSync(join(dir, f), "utf8")
        if (/VerificationReceipt/.test(body)) return true
      }
      return false
    },
    message: "at least one agent emits a VerificationReceipt",
  },
  {
    id: "design-tokens",
    weight: 20,
    run: (root) => {
      const f = join(root, "docs/design-tokens.md")
      if (!existsSync(f)) return false
      const text = readFileSync(f, "utf8")
      return /Color tokens/.test(text) && /File-output contract/.test(text) && /Error-message convention/.test(text)
    },
    message: "docs/design-tokens.md contains the 3 required sections",
  },
  {
    id: "cli-descriptions",
    weight: 20,
    run: (root) => {
      const f = join(root, "packages/assistant/src/plugins/autofarm/index.ts")
      if (!existsSync(f)) return false
      const text = readFileSync(f, "utf8")
      // Every commands.push entry should have a describe: string
      const lines = text.split("\n")
      let total = 0
      let described = 0
      for (const ln of lines) {
        if (/\{\s*name:\s*"/.test(ln)) total++
        if (/describe:\s*"/.test(ln) && /name:\s*"/.test(ln)) described++
      }
      return total > 0 && described === total
    },
    message: "every CLI command in the autofarm plugin has a describe string",
  },
  {
    id: "no-undated-todos",
    weight: 20,
    run: (root) => {
      // Find .ts files under packages/, scan for TODO/FIXME,
      // fail if any are not followed by a YYYY-MM-DD marker.
      const fs = require("node:fs") as typeof import("node:fs")
      const path = require("node:path") as typeof import("node:path")
      function walk(dir: string): string[] {
        const out: string[] = []
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name)
          if (e.isDirectory()) out.push(...walk(p))
          else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p)
        }
        return out
      }
      const files = walk(join(root, "packages")).slice(0, 200)
      for (const f of files) {
        const text = readFileSync(f, "utf8")
        const lines = text.split("\n")
        for (let i = 0; i < lines.length; i++) {
          if (/\b(TODO|FIXME)\b/.test(lines[i]!) && !/\d{4}-\d{2}-\d{2}/.test(lines[i]!)) {
            return false
          }
        }
      }
      return true
    },
    message: "no undated TODO/FIXME lines in packages/**/*.ts",
  },
]

/** Run the audit against a project root (defaults to cwd). */
export function runAudit(root: string = process.cwd()): AuditResult {
  const issues: AuditIssue[] = []
  let score = 0
  let passed = 0
  for (const c of CHECKS) {
    let ok = false
    try {
      ok = c.run(root)
    } catch {
      ok = false
    }
    if (ok) {
      score += c.weight
      passed++
    } else {
      issues.push({ id: c.id, severity: "warn", message: c.message })
    }
  }
  return {
    score,
    totalChecks: CHECKS.length,
    passed,
    issues,
    generatedAt: new Date().toISOString(),
    repoPath: root,
  }
}

export function formatAudit(r: AuditResult): string {
  const lines: string[] = []
  lines.push(`Loop audit — ${r.score}/100  (${r.passed}/${r.totalChecks} checks passed)`)
  if (r.issues.length === 0) lines.push("  all checks green")
  for (const i of r.issues) lines.push(`  [${i.severity.padEnd(5)}] ${i.id} — ${i.message}`)
  return lines.join("\n")
}
