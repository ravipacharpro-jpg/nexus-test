// quick-ack: instant acknowledgment system.
// When user sends a task, agent immediately replies with a short
// 1-line "working on it" message (Manus/Claude style), then the real
// work happens in background. User never sees an empty wait or queue popup.
//
// Example flow:
//   user: "Build me a todo app"
//   agent: "[OK] on it - building todo app, will take ~30s"
//   ... (background work) ...
//   agent: "Done. Files created: ..."
//
// The ack is fired by the NEXUS agent loop BEFORE doing the actual work.
// It uses the priority-router with bucket 80 (user) so it shows up
// immediately to the user, not buried in progress (40) messages.

import { emit } from "./priority-router.ts"

export interface AckOptions {
  /** What the user asked (used to summarize). */
  task: string
  /** Optional estimated time, e.g. "~30s", "1-2min". */
  eta?: string
  /** Optional verbose mode — single detailed line instead of short ack. */
  verbose?: boolean
}

/** Quick patterns to make acks feel human, not robotic. */
const ACK_PATTERNS = [
  (t: string) => `[OK] on it - ${t}`,
  (t: string) => `[OK] working on: ${t}`,
  (t: string) => `[OK] got it, ${t}...`,
  (t: string) => `[OK] on it. ${t}.`,
  (t: string) => `[+] doing it now: ${t}`,
]

const VERBOSE_PATTERNS = [
  (t: string, eta?: string) => `[OK] starting: ${t}${eta ? ` (ETA ${eta})` : ""}`,
  (t: string, eta?: string) => `[OK] kicking off ${t}${eta ? `, will take ~${eta}` : ""}`,
]

/** Summarize a task into <= 60 chars for the ack line. */
function summarize(task: string): string {
  let s = task.replace(/\s+/g, " ").trim()
  if (s.length > 60) s = s.slice(0, 57) + "..."
  return s
}

/** Pick a random ack pattern (so it doesn't feel scripted). */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** Fire an instant acknowledgment. Returns the text that was emitted. */
export function quickAck(opts: AckOptions): string {
  const summary = summarize(opts.task || "your request")
  const pattern = opts.verbose
    ? pick(VERBOSE_PATTERNS)(summary, opts.eta)
    : pick(ACK_PATTERNS)(summary)
  emit(80, "quick-ack", pattern, {
    ack: true,
    task: opts.task,
    eta: opts.eta,
  })
  return pattern
}

/** Convenience: ack with auto-ETA based on task type. */
export function autoAck(task: string): string {
  let eta: string | undefined
  const lower = task.toLowerCase()
  if (/^(hi|hello|hey|thanks|thank you|bye)/i.test(task)) {
    eta = "instant"
  } else if (/\b(search|find|look up|check|status)\b/i.test(lower)) {
    eta = "5-10s"
  } else if (/\b(build|create|make|implement|add|setup|scaffold)\b/i.test(lower)) {
    eta = "30-90s"
  } else if (/\b(debug|fix|repair|investigate|diagnose)\b/i.test(lower)) {
    eta = "1-2min"
  } else if (/\b(deploy|publish|release|ship)\b/i.test(lower)) {
    eta = "2-5min"
  } else if (/\b(refactor|rewrite|redesign)\b/i.test(lower)) {
    eta = "5-15min"
  } else {
    eta = "30s"
  }
  return quickAck({ task, eta, verbose: true })
}

/** Programmatic: the host (NEXUS agent loop) calls this on every user msg. */
export interface AckHook {
  (task: string): string
}

export function installAckHook(): AckHook {
  return (task: string) => autoAck(task)
}
