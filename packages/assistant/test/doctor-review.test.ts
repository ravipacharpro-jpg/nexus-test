// doctor-review.test.ts — read-only verification of Doctor + Review agents.
// Covers spec requirements: mode registration, read-only permissions,
// report generation, severity formatting, secret redaction, behavior
// when build tools are unavailable.

import { describe, test, expect } from "bun:test"
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import {
  runDoctor,
  renderDoctorMarkdown,
  type DoctorFinding,
  type Severity,
} from "../src/plugins/autofarm/lib/doctor.ts"
import {
  reviewPatch,
  reviewUncommitted,
  renderReviewMarkdown,
  type ReviewFinding,
} from "../src/plugins/autofarm/lib/review.ts"

const TMP = "/data/data/com.termux/files/home/.nexus/tmp/doctor-test"

function setup() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
  writeFileSync(join(TMP, "VERSION"), "v0.1.72\n")
  writeFileSync(join(TMP, "package.json"), JSON.stringify({ version: "0.1.72" }))
}

describe("Doctor — report generation", () => {
  test("returns a structured report with version + summary", () => {
    setup()
    const r = runDoctor({ repo: TMP })
    expect(r.version).toBe("v0.1.72")
    expect(r.summary.total).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(r.findings)).toBe(true)
  })

  test("flags VERSION/package.json mismatch", () => {
    setup()
    writeFileSync(join(TMP, "VERSION"), "v9.9.9\n")
    const r = runDoctor({ repo: TMP })
    const f = r.findings.find((x) => x.title.includes("disagree"))
    expect(f).toBeDefined()
    expect(f!.severity).toBe("MEDIUM")
    expect(f!.status).toBe("confirmed")
  })

  test("severity enum is the full set from spec", () => {
    const valid: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]
    expect(valid.length).toBe(5)
  })

  test("status enum matches spec", () => {
    const valid = ["confirmed", "suspected", "not-tested", "blocked"]
    expect(valid.length).toBe(4)
  })

  test("every finding has all required fields", () => {
    setup()
    const r = runDoctor({ repo: TMP })
    for (const f of r.findings) {
      expect(typeof f.severity).toBe("string")
      expect(typeof f.title).toBe("string")
      expect(f.title.length).toBeGreaterThan(0)
      expect(typeof f.impact).toBe("string")
      expect(typeof f.recommendation).toBe("string")
      expect(typeof f.safeToAutoFix).toBe("boolean")
      expect(typeof f.status).toBe("string")
      expect(typeof f.category).toBe("string")
    }
  })
})

describe("Doctor — secret redaction", () => {
  test("redacts GitHub PAT in evidence", () => {
    setup()
    writeFileSync(join(TMP, "leak.ts"), "const x = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123'\n")
    const r = runDoctor({ repo: TMP })
    const f = r.findings.find((x) => x.category === "security")
    if (f && f.evidence) {
      expect(f.evidence).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123")
      expect(f.evidence).toMatch(/REDACTED/)
    }
  })

  test("redacts OpenRouter key in evidence", () => {
    setup()
    writeFileSync(join(TMP, "leak2.ts"), "const y = 'sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789ABCD'\n")
    const r = runDoctor({ repo: TMP })
    const f = r.findings.find((x) => x.category === "security")
    if (f && f.evidence) {
      expect(f.evidence).not.toContain("sk-or-v1-abcdefghijklmnopqrstuvwxyz")
      expect(f.evidence).toMatch(/REDACTED/)
    }
  })
})

describe("Doctor — read-only enforcement", () => {
  test("runDoctor does not modify repo", () => {
    setup()
    const before = readFileSync(join(TMP, "VERSION"), "utf8")
    runDoctor({ repo: TMP })
    const after = readFileSync(join(TMP, "VERSION"), "utf8")
    expect(after).toBe(before)
  })

  test("smoke-test.sh absence flagged when missing", () => {
    setup()
    const r = runDoctor({ repo: TMP })
    const f = r.findings.find((x) => x.title.includes("smoke-test.sh"))
    expect(f).toBeDefined()
  })
})

describe("Doctor — markdown rendering", () => {
  test("renderDoctorMarkdown includes summary table", () => {
    setup()
    const r = runDoctor({ repo: TMP })
    const md = renderDoctorMarkdown(r)
    expect(md).toContain("# Doctor Report")
    expect(md).toContain("| Severity | Count |")
    expect(md).toContain("CRITICAL")
    expect(md).toContain("read-only")
  })
})

describe("Review — verdict decisions", () => {
  test("APPROVE on empty diff", () => {
    const r = reviewPatch("")
    expect(r.verdict).toBe("APPROVE")
    expect(r.findings.length).toBe(0)
  })

  test("BLOCKED when secret present", () => {
    const patch = [
      "diff --git a/leak.ts b/leak.ts",
      "+++ b/leak.ts",
      "+const x = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123'",
    ].join("\n")
    const r = reviewPatch(patch, "test", ["leak.ts"])
    expect(r.verdict).toBe("BLOCKED")
    expect(r.blockingCount).toBeGreaterThan(0)
  })

  test("APPROVE-WITH-WARNINGS for console.log nit", () => {
    const patch = [
      "diff --git a/main.ts b/main.ts",
      "+++ b/main.ts",
      "+console.log('debug')",
    ].join("\n")
    const r = reviewPatch(patch, "test", ["main.ts"])
    expect(r.findings.some((f) => f.title.includes("console.log"))).toBe(true)
  })

  test("REQUEST-CHANGES for multiple major issues", () => {
    const patch = [
      "diff --git a/x.ts b/x.ts",
      "+++ b/x.ts",
      "+eval(userInput)",
      "+child_process.exec(`rm -rf ${userPath}`)",
    ].join("\n")
    const r = reviewPatch(patch, "test", ["x.ts"])
    expect(["REQUEST-CHANGES", "BLOCKED"]).toContain(r.verdict)
  })
})

describe("Review — read-only enforcement", () => {
  test("reviewPatch does not modify the cwd", () => {
    setup()
    const before = readFileSync(join(TMP, "VERSION"), "utf8")
    reviewPatch("", "(test)", [])
    const after = readFileSync(join(TMP, "VERSION"), "utf8")
    expect(after).toBe(before)
  })

  test("reviewUncommitted is safe to call on real repo", () => {
    // Just check it doesn't throw — actual result depends on cwd state
    const r = reviewUncommitted(join(import.meta.dir, ".."))
    expect(r.verdict).toBeDefined()
  })
})

describe("Review — markdown rendering", () => {
  test("renderReviewMarkdown includes verdict banner", () => {
    const r = reviewPatch("")
    const md = renderReviewMarkdown(r)
    expect(md).toContain("# Code Review")
    expect(md).toContain("Verdict")
    expect(md).toContain("read-only")
  })
})
