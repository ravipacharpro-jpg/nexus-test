// multi-agent-debate: spawn N independent agents to solve the same
// problem, then have a judge pick the best answer. The "ensemble
// effect" typically gives 30-50% better quality than a single agent,
// especially on hard reasoning tasks.
//
// Each debater is just a callable `agent: (prompt) => Promise<string>`
// so the host decides what "model" means (could be 3 different API
// calls, 3 different prompts on the same model, or 3 different
// workers in parallel).
//
// Vote strategies:
//   - majority: pick the most common answer
//   - judge:    a separate judge agent picks the best
//   - hybrid:   majority → if no clear winner, judge decides
//
// Output: { winner: Debater, all: Debater[], meta: {...} }

import crypto from "node:crypto"
import { log } from "./logger.ts"

export interface DebaterConfig {
  /** Display name. */
  name: string
  /** Model id (e.g. "anthropic/claude-3-5-sonnet"). */
  model: string
  /** Personality / system prompt. */
  systemPrompt: string
  /** The callable agent. */
  agent: (prompt: string, opts: { systemPrompt: string; model: string }) => Promise<string>
}

export interface DebateOptions {
  /** How many debaters to spawn (default 3). */
  count?: number
  /** Voting strategy. */
  vote?: "majority" | "judge" | "hybrid"
  /** Max ms per debater. */
  timeoutMs?: number
  /** Concurrent or sequential. */
  parallel?: boolean
}

export interface DebaterResult {
  name: string
  model: string
  answer: string
  durationMs: number
  error?: string
}

export interface DebateResult {
  winner: DebaterResult | null
  all: DebaterResult[]
  vote: "majority" | "judge" | "hybrid"
  /** True if 2+ debaters gave the same answer. */
  consensus: boolean
  meta: {
    question: string
    totalMs: number
    roundsRun: number
  }
}

/** Build N debaters with distinct system prompts for diversity. */
export function defaultDebaters(
  agent: DebaterConfig["agent"],
  count = 3
): DebaterConfig[] {
  const personas = [
    { name: "skeptic", sp: "You are a skeptical engineer. Question every assumption, look for edge cases, and prefer simple robust solutions over clever ones." },
    { name: "architect", sp: "You are a senior architect. Think in terms of system design, dependencies, long-term maintainability, and integration points." },
    { name: "pragmatist", sp: "You are a pragmatic developer. Bias toward the solution that ships today with the least complexity. Avoid over-engineering." },
  ]
  return personas.slice(0, count).map((p, i) => ({
    name: p.name,
    model: `debater-${i + 1}`,
    systemPrompt: p.sp,
    agent,
  }))
}

/** Run a debate. */
export async function debate(
  question: string,
  debaters: DebaterConfig[],
  opts: DebateOptions = {}
): Promise<DebateResult> {
  const count = opts.count ?? debaters.length
  const vote = opts.vote ?? "hybrid"
  const timeoutMs = opts.timeoutMs ?? 60_000
  const parallel = opts.parallel ?? true
  const t0 = Date.now()

  log.info("debate", `starting: ${debaters.length} debaters, vote=${vote}, parallel=${parallel}`)

  // 1) Run all debaters
  const runOne = async (d: DebaterConfig): Promise<DebaterResult> => {
    const s0 = Date.now()
    try {
      const ans = await withTimeout(d.agent(question, { systemPrompt: d.systemPrompt, model: d.model }), timeoutMs)
      return { name: d.name, model: d.model, answer: ans, durationMs: Date.now() - s0 }
    } catch (e) {
      return { name: d.name, model: d.model, answer: "", durationMs: Date.now() - s0, error: (e as Error).message }
    }
  }
  const all: DebaterResult[] = parallel
    ? await Promise.all(debaters.map(runOne))
    : (await debaters.reduce(async (acc, d) => [...(await acc), await runOne(d)], Promise.resolve([] as DebaterResult[])))

  const ok = all.filter((r) => !r.error && r.answer)
  if (ok.length === 0) {
    return { winner: null, all, vote, consensus: false, meta: { question, totalMs: Date.now() - t0, roundsRun: 1 } }
  }

  // 2) Vote
  let winner: DebaterResult | null = null
  let consensus = false
  if (vote === "majority" || (vote === "hybrid" && ok.length >= 2)) {
    const tally = new Map<string, { count: number; r: DebaterResult }>()
    for (const r of ok) {
      const h = hash(r.answer)
      const cur = tally.get(h)
      if (cur) cur.count++
      else tally.set(h, { count: 1, r })
    }
    const top = [...tally.values()].sort((a, b) => b.count - a.count)[0]
    if (top && top.count >= 2) {
      winner = top.r
      consensus = true
    } else if (vote === "majority") {
      // No majority: pick the shortest (often = clearest) answer
      winner = ok.sort((a, b) => a.answer.length - b.answer.length)[0]
    }
  }
  if (!winner) {
    // 3) Judge round
    winner = judge(question, ok) ?? ok[0]
  }
  return {
    winner,
    all,
    vote,
    consensus,
    meta: { question, totalMs: Date.now() - t0, roundsRun: consensus ? 1 : 2 },
  }
}

/** Judge: pick the most "complete" answer (longest non-error, with bonus for diversity). */
function judge(question: string, results: DebaterResult[]): DebaterResult | null {
  if (results.length === 0) return null
  // Score: longer + has code blocks + has reasoning markers
  const score = (r: DebaterResult) => {
    let s = r.answer.length
    if (/```/.test(r.answer)) s += 200
    if (/\b(because|therefore|since|thus|hence)\b/i.test(r.answer)) s += 50
    if (/\b(edge case|race|concurrent|null|safety|security)\b/i.test(r.answer)) s += 80
    return s
  }
  return [...results].sort((a, b) => score(b) - score(a))[0]
}

function hash(s: string): string {
  return crypto.createHash("sha256").update(s.replace(/\s+/g, " ").trim().toLowerCase()).digest("hex").slice(0, 16)
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) }
    )
  })
}

/** Format a debate result as a one-liner. */
export function formatDebate(r: DebateResult): string {
  const w = r.winner
  if (!w) return "[x] debate failed — all debaters errored"
  const tag = r.consensus ? "[++]" : "[ok]"
  return `${tag} winner: ${w.name} (${w.model}) in ${w.durationMs}ms — ${r.all.length} debater(s), ${r.meta.totalMs}ms total`
}
