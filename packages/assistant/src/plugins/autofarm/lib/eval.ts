// agenta-lite: lightweight agent evaluation framework
// Inspired by https://github.com/agenta-ai/agenta
//
// Tracks agent runs with structured scores (latency, cost, success, quality)
// and supports LLM-as-judge for subjective scoring.
//
// Usage:
//   const run = startRun("gmail-creation", { account: "n***@gmail.com" })
//   run.recordStep("navigate", { ok: true, ms: 1234 })
//   run.recordStep("fill", { ok: true, ms: 567 })
//   run.score("quality", 0.85, "judge-llm")
//   await run.finish({ ok: true })

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { log } from "./logger.ts"

const STORE_DIR = path.join(os.homedir(), ".nexus", "autofarm", "evals")
fs.mkdirSync(STORE_DIR, { recursive: true })

export interface EvalStep {
  name: string
  ok: boolean
  ms: number
  detail?: string
  ts: number
}

export interface EvalScore {
  metric: string
  value: number // 0..1
  judge?: string // e.g. "llm:gpt-4o", "human:you", "rule:duration"
  comment?: string
  ts: number
}

export interface EvalRun {
  id: string
  task: string
  input: Record<string, unknown>
  steps: EvalStep[]
  scores: EvalScore[]
  startedAt: number
  finishedAt?: number
  ok?: boolean
  error?: string
  /** Latency stats derived from steps. */
  totalMs?: number
}

function nextId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function runFile(id: string): string {
  return path.join(STORE_DIR, `${id}.json`)
}

export function startRun(task: string, input: Record<string, unknown> = {}): {
  id: string
  recordStep(name: string, data: Omit<EvalStep, "name" | "ts">): void
  recordSteps(steps: Omit<EvalStep, "ts">[]): void
  score(metric: string, value: number, judge?: string, comment?: string): void
  finish(result: { ok: boolean; error?: string }): Promise<EvalRun>
  snapshot(): EvalRun
} {
  const id = nextId()
  const run: EvalRun = { id, task, input, steps: [], scores: [], startedAt: Date.now() }
  fs.writeFileSync(runFile(id), JSON.stringify(run, null, 2))
  log.info("eval", `start ${task} (id=${id})`)

  function persist() {
    try { fs.writeFileSync(runFile(id), JSON.stringify(run, null, 2)) } catch {}
  }

  return {
    id,
    recordStep(name, data) {
      run.steps.push({ name, ts: Date.now(), ...data })
      persist()
    },
    recordSteps(steps) {
      for (const s of steps) run.steps.push({ ...s, ts: Date.now() })
      persist()
    },
    score(metric, value, judge, comment) {
      run.scores.push({ metric, value, judge, comment, ts: Date.now() })
      persist()
    },
    async finish({ ok, error }) {
      run.finishedAt = Date.now()
      run.ok = ok
      run.error = error
      run.totalMs = run.steps.reduce((s, st) => s + st.ms, 0)
      persist()
      log.info("eval", `finish ${task} (id=${id}) ok=${ok} ms=${run.totalMs}`)
      return run
    },
    snapshot() {
      return JSON.parse(JSON.stringify(run)) as EvalRun
    },
  }
}

export function getRun(id: string): EvalRun | null {
  try { return JSON.parse(fs.readFileSync(runFile(id), "utf8")) as EvalRun } catch { return null }
}

export function listRuns(limit = 50): EvalRun[] {
  try {
    return fs.readdirSync(STORE_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, limit)
      .map((f) => {
        try { return JSON.parse(fs.readFileSync(path.join(STORE_DIR, f), "utf8")) as EvalRun } catch { return null }
      })
      .filter((r): r is EvalRun => Boolean(r))
  } catch { return [] }
}

export interface AggregateStats {
  totalRuns: number
  okRate: number
  avgLatencyMs: number
  byTask: Record<string, { count: number; okRate: number; avgLatencyMs: number }>
  byScore: Record<string, { count: number; avgValue: number }>
}

export function aggregateStats(runs: EvalRun[]): AggregateStats {
  const out: AggregateStats = {
    totalRuns: runs.length,
    okRate: 0,
    avgLatencyMs: 0,
    byTask: {},
    byScore: {},
  }
  if (runs.length === 0) return out
  let ok = 0
  let total = 0
  for (const r of runs) {
    if (r.ok) ok++
    total += r.totalMs ?? 0
    if (!out.byTask[r.task]) out.byTask[r.task] = { count: 0, okRate: 0, avgLatencyMs: 0 }
    const t = out.byTask[r.task]
    t.count++
    if (r.ok) t.okRate = (t.okRate * (t.count - 1) + 1) / t.count
    else t.okRate = (t.okRate * (t.count - 1)) / t.count
    t.avgLatencyMs = (t.avgLatencyMs * (t.count - 1) + (r.totalMs ?? 0)) / t.count
    for (const s of r.scores) {
      if (!out.byScore[s.metric]) out.byScore[s.metric] = { count: 0, avgValue: 0 }
      const sm = out.byScore[s.metric]
      sm.count++
      sm.avgValue = (sm.avgValue * (sm.count - 1) + s.value) / sm.count
    }
  }
  out.okRate = ok / runs.length
  out.avgLatencyMs = total / runs.length
  return out
}

/** LLM-as-judge: returns a quality score 0..1 for a free-form output. */
export async function judgeOutput(
  output: string,
  criterion: string,
  judgeFn: (prompt: string) => Promise<string>,
): Promise<{ score: number; reasoning: string }> {
  const prompt = `You are a strict evaluator. Score the following output on a scale of 0.0 to 1.0 for this criterion:

**Criterion**: ${criterion}

**Output**:
\`\`\`
${output.slice(0, 2000)}
\`\`\`

Respond in EXACTLY this format:
<score>0.X</score>
<reasoning>one sentence</reasoning>`

  try {
    const reply = await judgeFn(prompt)
    const m = reply.match(/<score>\s*([0-9.]+)\s*<\/score>/i)
    const reasonMatch = reply.match(/<reasoning>\s*([\s\S]+?)\s*<\/reasoning>/i)
    return {
      score: m ? Math.max(0, Math.min(1, parseFloat(m[1]))) : 0.5,
      reasoning: reasonMatch?.[1]?.trim() ?? "(no reasoning)",
    }
  } catch {
    return { score: 0.5, reasoning: "judge failed" }
  }
}

export function evalDir(): string {
  return STORE_DIR
}
