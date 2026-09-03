// progress-tracker: track multi-step task progress, ETA, and produce
// a single status line. Used for "building a feature" workflows where
// the agent runs 5-20 sub-steps and the user wants to see one updated
// line per step (not a flood).
//
// ASCII only — no emoji. Renders a 10-char progress bar.

export interface SubStep {
  id: string
  label: string
  status: "pending" | "running" | "ok" | "warn" | "err" | "skipped"
  startedAt?: number
  finishedAt?: number
  /** ETA / elapsed in ms (filled by tracker). */
  durationMs?: number
}

export interface ProgressSnapshot {
  task: string
  total: number
  done: number
  running: number
  pending: number
  failed: number
  percent: number
  etaMs: number
  bar: string
  oneLiner: string
}

const BAR_FULL = "#"
const BAR_EMPTY = "-"
const BAR_WIDTH = 10

function bar(p: number): string {
  const filled = Math.round((Math.max(0, Math.min(100, p)) / 100) * BAR_WIDTH)
  return "[" + BAR_FULL.repeat(filled) + BAR_EMPTY.repeat(BAR_WIDTH - filled) + "]"
}

class ProgressTracker {
  private task = ""
  private steps: SubStep[] = []
  private stepIndex = 0
  private startedAt = 0

  begin(task: string, steps: string[]): void {
    this.task = task
    this.steps = steps.map((label, i) => ({
      id: `s${i}`,
      label,
      status: "pending",
    }))
    this.stepIndex = 0
    this.startedAt = Date.now()
  }

  next(label?: string): SubStep | null {
    if (this.stepIndex >= this.steps.length) return null
    const s = this.steps[this.stepIndex]
    if (label) s.label = label
    s.status = "running"
    s.startedAt = Date.now()
    return s
  }

  markCurrent(status: "ok" | "warn" | "err" | "skipped", durationMs?: number): void {
    if (this.stepIndex >= this.steps.length) return
    const s = this.steps[this.stepIndex]
    s.status = status
    s.finishedAt = Date.now()
    s.durationMs = durationMs ?? (s.startedAt ? Date.now() - s.startedAt : 0)
    this.stepIndex++
  }

  jumpTo(label: string): SubStep | null {
    const idx = this.steps.findIndex((s) => s.label === label)
    if (idx < 0) return null
    this.stepIndex = idx
    return this.next()
  }

  snapshot(): ProgressSnapshot {
    const total = this.steps.length
    const done = this.steps.filter((s) => s.status === "ok" || s.status === "skipped").length
    const failed = this.steps.filter((s) => s.status === "err").length
    const running = this.steps.filter((s) => s.status === "running").length
    const pending = total - done - failed - running
    const percent = total > 0 ? Math.round((done / total) * 100) : 0
    // ETA: avg ms per done step × remaining
    const elapsed = this.startedAt ? Date.now() - this.startedAt : 0
    const perStep = done > 0 ? elapsed / done : 0
    const etaMs = perStep * (total - done)
    const current = this.steps.find((s) => s.status === "running")
    const curLabel = current ? current.label : (this.stepIndex < total ? this.steps[this.stepIndex].label : "done")
    return {
      task: this.task,
      total,
      done,
      running,
      pending,
      failed,
      percent,
      etaMs,
      bar: bar(percent),
      oneLiner: `Step ${Math.min(this.stepIndex + 1, total)}/${total}: ${curLabel} ${bar(percent)} ${percent}%`,
    }
  }

  format(): string {
    const s = this.snapshot()
    const eta = s.etaMs > 0 ? ` (ETA ${Math.ceil(s.etaMs / 1000)}s)` : ""
    return `${s.bar} ${s.percent}% — ${s.done}/${s.total} done${s.failed ? `, ${s.failed} failed` : ""}${eta}`
  }

  isDone(): boolean {
    return this.stepIndex >= this.steps.length
  }
}

const GLOBAL = new ProgressTracker()

export function tracker(): ProgressTracker { return GLOBAL }

/** Render a progress line for any {done,total} pair. */
export function render(done: number, total: number, label = ""): string {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return `${bar(pct)} ${pct}% — ${done}/${total} ${label}`.trim()
}

export type { ProgressTracker }
