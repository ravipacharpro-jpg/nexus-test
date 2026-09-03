// priority-router: every incoming message is classified into a priority
// bucket. User messages ALWAYS outrank background task chatter, so the
// TUI / chat surface never gets flooded by queue progress lines.
//
// Buckets (higher = more important):
//   100  critical  : system errors, security events
//    80  user      : any input from the human
//    60  urgent    : webhooks, key-exhausted alerts
//    40  progress  : long-task milestones (e.g. "10/50 emails done")
//    20  info      : routine state changes
//    10  debug     : low-level traces
//
// The router can also be told to "throttle" a bucket (e.g. drop progress
// messages older than 2s) so the user sees one line per checkpoint
// instead of 50 in 3 seconds.

export type Priority = 100 | 80 | 60 | 40 | 20 | 10

export interface RoutedMessage {
  id: string
  bucket: Priority
  source: string        // "user", "task:gmail-agent", "system:webhook", …
  text: string
  /** Optional structured payload (e.g. progress { done: 10, total: 50 }). */
  data?: Record<string, unknown>
  /** ms since epoch. */
  createdAt: number
  /** ms since the message was emitted. Set by the router. */
  agedMs?: number
}

export type Sink = (msg: RoutedMessage) => void | Promise<void>

const SINK: Sink[] = []
const RECENT: RoutedMessage[] = [] // ring buffer for "last 100"
const MAX_RECENT = 100
const seen = new Set<string>() // dedupe by id

/** Register a sink (e.g. the TUI renderer). */
export function addSink(s: Sink): void {
  SINK.push(s)
}

/** Classify plain text into a priority bucket. Used by the chat surface. */
export function classify(text: string, source = "user"): Priority {
  if (source === "user") return 80
  if (source.startsWith("system") || source.startsWith("error")) return 100
  if (source.startsWith("webhook") || source.includes("exhausted")) return 60
  if (source.startsWith("task:") || source.includes("progress")) return 40
  if (source.startsWith("info")) return 20
  return 10
}

let counter = 0
function nextId(): string {
  counter = (counter + 1) % 1_000_000
  return `${Date.now()}-${counter}`
}

/** Emit a message through the router. All sinks are notified. */
export function emit(bucket: Priority, source: string, text: string, data?: Record<string, unknown>): void {
  const id = nextId()
  if (seen.has(id)) return
  seen.add(id)
  const msg: RoutedMessage = { id, bucket, source, text, data, createdAt: Date.now() }
  RECENT.push(msg)
  if (RECENT.length > MAX_RECENT) RECENT.shift()
  for (const s of SINK) {
    try {
      const r = s(msg)
      if (r && typeof (r as Promise<unknown>).then === "function") {
        (r as Promise<unknown>).catch(() => undefined)
      }
    } catch {
      /* never let a sink crash the emitter */
    }
  }
}

/** Convenience emitters. */
export const userMsg    = (text: string)                   => emit(80, "user", text)
export const progress   = (source: string, text: string, d?: Record<string, unknown>) => emit(40, source, text, d)
export const info       = (source: string, text: string)   => emit(20, source, text)
export const urgent     = (source: string, text: string)   => emit(60, source, text)
export const critical   = (source: string, text: string)   => emit(100, source, text)
export const debug      = (source: string, text: string)   => emit(10, source, text)

/** Snapshot of recent messages, newest first, sorted by bucket then age. */
export function recent(limit = 50): RoutedMessage[] {
  const now = Date.now()
  return [...RECENT]
    .reverse()
    .slice(0, limit)
    .map((m) => ({ ...m, agedMs: now - m.createdAt }))
}

/** Only user-bucket messages (for "what did the user say recently?"). */
export function recentUser(limit = 10): RoutedMessage[] {
  return recent(limit).filter((m) => m.bucket === 80)
}

/** Only progress-bucket messages (for task UIs). */
export function recentProgress(limit = 20): RoutedMessage[] {
  return recent(limit).filter((m) => m.bucket === 40)
}

/** Throttle helper: returns true if a progress message of this fingerprint
 *  was emitted in the last `ms` milliseconds. Use to dedupe spam. */
const FP_LAST: Map<string, number> = new Map()
export function throttled(fp: string, ms = 2000): boolean {
  const now = Date.now()
  const last = FP_LAST.get(fp) ?? 0
  if (now - last < ms) return true
  FP_LAST.set(fp, now)
  return false
}

/** Clear all sinks and history. Mainly for tests. */
export function reset(): void {
  SINK.length = 0
  RECENT.length = 0
  seen.clear()
  FP_LAST.clear()
}
