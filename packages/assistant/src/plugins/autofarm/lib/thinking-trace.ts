// thinking-trace: surface the agent's reasoning steps in the chat stream
// without dumping internal chain-of-thought. Each "thought" is a
// short, factual sentence, prefixed with an ASCII icon (no emoji).
//
// Lifecycle:
//   trace.start("Fix OAuth bug")
//   trace.think("Need to inspect auth.ts first")
//   trace.hypothesis("Race condition on line 42")
//   trace.check("Confirmed: line 42 acquires lock without check")
//   trace.decide("Add ownership check before acquisition")
//   trace.action("Editing auth.ts line 42")
//   trace.ok("12/12 tests passing")
//   trace.end()

export type Phase =
  | "start" | "think" | "hypothesis" | "check" | "decide"
  | "action" | "result" | "ok" | "warn" | "err" | "end"

const ICONS: Record<Phase, string> = {
  start:    ">>",  // begin
  think:    "..",  // pondering
  hypothesis: "?", // idea
  check:    "##",  // verify
  decide:   "->",  // commit
  action:   "**",  // do
  result:   "==",  // outcome
  ok:       "[+]", // success
  warn:     "[!]", // warning
  err:      "[x]", // failure
  end:      "<<",  // finish
}

export interface TraceStep {
  ts: number
  phase: Phase
  text: string
  /** Optional data (counts, ids, etc). */
  data?: Record<string, unknown>
}

export interface Trace {
  task: string
  startedAt: number
  steps: TraceStep[]
}

const ACTIVE: Trace[] = []

/** Start a new trace for a task. */
export function start(task: string): Trace {
  const t: Trace = { task, startedAt: Date.now(), steps: [] }
  ACTIVE.push(t)
  emit(t, "start", task)
  return t
}

/** Append a step to the most recent active trace. */
export function step(phase: Phase, text: string, data?: Record<string, unknown>): void {
  const t = ACTIVE[ACTIVE.length - 1]
  if (!t) return
  emit(t, phase, text, data)
}

/** Convenience aliases. */
export const think      = (text: string, d?: Record<string, unknown>) => step("think", text, d)
export const hypothesis = (text: string, d?: Record<string, unknown>) => step("hypothesis", text, d)
export const check      = (text: string, d?: Record<string, unknown>) => step("check", text, d)
export const decide     = (text: string, d?: Record<string, unknown>) => step("decide", text, d)
export const action     = (text: string, d?: Record<string, unknown>) => step("action", text, d)
export const result     = (text: string, d?: Record<string, unknown>) => step("result", text, d)
export const ok         = (text: string, d?: Record<string, unknown>) => step("ok", text, d)
export const warn       = (text: string, d?: Record<string, unknown>) => step("warn", text, d)
export const err        = (text: string, d?: Record<string, unknown>) => step("err", text, d)
export const end        = (text: string = "done") => {
  const t = ACTIVE[ACTIVE.length - 1]
  if (!t) return
  emit(t, "end", text)
  // pop finished trace
  ACTIVE.pop()
}

/** Format a single step as an ASCII-only line. */
export function formatStep(s: TraceStep): string {
  const tag = ICONS[s.phase]
  return `${tag} ${s.text}`
}

/** Format the whole trace as ASCII-only. */
export function formatTrace(t: Trace): string {
  const out: string[] = []
  out.push(`>> ${t.task}`)
  for (const s of t.steps) out.push(formatStep(s))
  out.push(`<< end (${t.steps.length} step(s), ${((Date.now() - t.startedAt) / 1000).toFixed(1)}s)`)
  return out.join("\n")
}

function emit(t: Trace, phase: Phase, text: string, data?: Record<string, unknown>) {
  const s: TraceStep = { ts: Date.now(), phase, text, ...(data ? { data } : {}) }
  t.steps.push(s)
  // also push to priority-router if it's loaded, else noop
  try {
    const r = require("./priority-router.ts") as typeof import("./priority-router.ts")
    r.emit(40, "trace", formatStep(s), data)
  } catch { /* not yet loaded or import resolution differs */ }
}
