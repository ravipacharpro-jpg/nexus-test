// eval-bench: minimal reproducible accuracy tracker for the
// partial agents. Each agent under test has a folder
// test/eval-cases/<agent-name>/ with N hand-crafted input +
// expected-output pairs. This script walks every pair, runs the
// agent, scores the output, and writes a summary to STATS.md.
//
// Scoring rules (intentionally simple, no LLM-as-judge to keep
// the loop fast and free):
//   1. If the agent returns ok:false, score 0.
//   2. Else if the expected output is an exact string, score 1
//      on equality, 0 otherwise.
//   3. Else if the expected output is a regex, score 1 on match.
//   4. Else if the expected output is a JSON object, score 1 when
//      every key in the expected object is present in the agent's
//      output with a compatible type.
//
// The output of this script is intended to be committed to
// STATS.md so the trend is visible in the repo.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, "..", "..")
const CASES_DIR = path.join(REPO_ROOT, "test", "eval-cases")
const STATS = path.join(REPO_ROOT, "STATS.md")

interface EvalCase {
  name: string
  input: unknown
  /** String | RegExp | Record<string, unknown>. See scoring rules. */
  expected: unknown
}

interface AgentEvalSet {
  agent: string
  /** Module path that exports a run(input) → Promise<unknown> */
  run: (input: unknown) => Promise<unknown>
  cases: EvalCase[]
}

async function readCaseFile(agent: string, name: string): Promise<EvalCase | undefined> {
  const fp = path.join(CASES_DIR, agent, `${name}.json`)
  if (!fs.existsSync(fp)) return undefined
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8")) as EvalCase
  } catch {
    return undefined
  }
}

function score(actual: unknown, expected: unknown): { ok: boolean; reason: string } {
  if (actual === null || typeof actual !== "object") {
    if (expected === actual) return { ok: true, reason: "exact" }
    return { ok: false, reason: "agent returned non-object" }
  }
  const a = actual as Record<string, unknown> & { ok?: unknown; receipts?: Array<{ exitCode: number }> }
  if (a.ok === false) return { ok: false, reason: "agent returned ok:false" }
  if (Array.isArray(a.receipts) && a.receipts.some((r) => r?.exitCode !== 0)) {
    return { ok: false, reason: "agent had a non-zero receipt" }
  }
  if (typeof expected === "string") {
    const summary = (a as { summary?: string }).summary ?? ""
    return { ok: summary.includes(expected), reason: "string match" }
  }
  if (expected instanceof RegExp) {
    const summary = (a as { summary?: string }).summary ?? ""
    return { ok: expected.test(summary), reason: "regex match" }
  }
  if (typeof expected === "object" && expected !== null) {
    for (const [k, v] of Object.entries(expected as Record<string, unknown>)) {
      if (!(k in a)) return { ok: false, reason: `missing key: ${k}` }
      if (typeof v !== typeof a[k]) return { ok: false, reason: `key ${k} type mismatch` }
    }
    return { ok: true, reason: "object keys + types match" }
  }
  return { ok: false, reason: "unknown expected type" }
}

async function runOne(set: AgentEvalSet): Promise<{ agent: string; passed: number; total: number }> {
  let passed = 0
  for (const c of set.cases) {
    try {
      const out = await set.run(c.input)
      const s = score(out, c.expected)
      if (s.ok) passed++
      else console.log(`  [FAIL] ${set.agent}/${c.name}: ${s.reason}`)
    } catch (e) {
      console.log(`  [ERR ] ${set.agent}/${c.name}: ${(e as Error).message}`)
    }
  }
  return { agent: set.agent, passed, total: set.cases.length }
}

/** Discover every <agent>/<name>.json file under test/eval-cases. */
export async function discoverCases(): Promise<Record<string, string[]>> {
  if (!fs.existsSync(CASES_DIR)) return {}
  const out: Record<string, string[]> = {}
  for (const agent of fs.readdirSync(CASES_DIR)) {
    const dir = path.join(CASES_DIR, agent)
    if (!fs.statSync(dir).isDirectory()) continue
    out[agent] = []
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".json")) out[agent]!.push(f.replace(/\.json$/, ""))
    }
  }
  return out
}

export interface EvalReport {
  generatedAt: string
  rows: Array<{ agent: string; passed: number; total: number; score: number }>
}

/** Run the full benchmark. The 'agents' argument wires the real
 *  agent modules. We keep it as a parameter so the script is
 *  testable in isolation without booting the whole repo. */
export async function runEval(agents: AgentEvalSet[]): Promise<EvalReport> {
  const results = await Promise.all(agents.map(runOne))
  return {
    generatedAt: new Date().toISOString(),
    rows: results.map((r) => ({
      agent: r.agent,
      passed: r.passed,
      total: r.total,
      score: r.total === 0 ? 0 : Math.round((r.passed / r.total) * 100),
    })),
  }
}

export function formatReport(r: EvalReport): string {
  const lines: string[] = []
  lines.push(`Agent Accuracy Benchmarks — ${r.generatedAt}`)
  lines.push("")
  for (const row of r.rows) {
    lines.push(`- ${row.agent.padEnd(20)} ${row.passed}/${row.total}  (${row.score}%)`)
  }
  return lines.join("\n")
}

/** Append the report to the existing STATS.md under a stable anchor. */
export function appendToStats(r: EvalReport): void {
  if (!fs.existsSync(STATS)) return
  const body = fs.readFileSync(STATS, "utf8")
  const marker = "<!-- eval-bench:auto:start -->"
  const end = "<!-- eval-bench:auto:end -->"
  if (!body.includes(marker)) return
  const block = `${marker}\n${formatReport(r)}\n${end}\n`
  const next = body.replace(new RegExp(`${marker}[\\s\\S]*?${end}\\n?`), block)
  fs.writeFileSync(STATS, next)
}

// Convenience: load case files for one agent by directory name.
export async function loadCases(agent: string): Promise<EvalCase[]> {
  const dir = path.join(CASES_DIR, agent)
  if (!fs.existsSync(dir)) return []
  const out: EvalCase[] = []
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue
    try {
      const c = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as EvalCase
      out.push(c)
    } catch {
      // skip malformed
    }
  }
  return out
}
