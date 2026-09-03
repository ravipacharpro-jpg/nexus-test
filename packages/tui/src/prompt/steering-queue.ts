/**
 * In-memory pending queue for messages typed while a task is active. Entries
 * are visible, editable, and removable from the session timeline and are
 * dispatched FIFO through the normal prompt path when the session becomes
 * idle. The queue is intentionally not persisted: after a restart nothing is
 * silently resumed or redispatched.
 *
 * Deliberately dependency-free (no framework imports) so the exact module
 * under test resolves and runs identically in any clean audited environment.
 * The session route subscribes with `subscribe` and bridges notifications
 * into Solid reactivity.
 */

export type PendingPrompt = {
  id: string
  sessionID: string
  /** "next" items dispatch right after an explicit cancellation; "followup" items wait for the active turn to finish. */
  kind: "next" | "followup"
  input: string
  parts: readonly unknown[]
}

let items: PendingPrompt[] = []
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export const pendingPrompts = {
  list(sessionID: string): PendingPrompt[] {
    return items.filter((item) => item.sessionID === sessionID)
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  add(item: Omit<PendingPrompt, "id">): PendingPrompt {
    const entry: PendingPrompt = { ...item, id: crypto.randomUUID() }
    items = [...items, entry]
    notify()
    return entry
  },
  remove(id: string) {
    const next = items.filter((item) => item.id !== id)
    if (next.length === items.length) return
    items = next
    notify()
  },
  /** Takes the oldest item for a session that became idle. */
  take(sessionID: string): PendingPrompt | undefined {
    const index = items.findIndex((item) => item.sessionID === sessionID)
    if (index === -1) return undefined
    const [taken] = items.splice(index, 1)
    notify()
    return taken
  },
}

// Per-session latch: set when an item is dispatched so a lagging idle status
// event cannot double-dispatch; cleared once the session is seen busy again.
const expectingBusy = new Map<string, boolean>()

export const steeringFlow = {
  /** Marks a session as having just dispatched an item. */
  mark(sessionID: string) {
    expectingBusy.set(sessionID, true)
  },
  /** Clears the latch once the session is observed busy (or leaves idle state). */
  settle(sessionID: string) {
    expectingBusy.set(sessionID, false)
  },
  /** True when an idle transition may safely dispatch the next queued item. */
  shouldDispatch(sessionID: string) {
    return expectingBusy.get(sessionID) !== true
  },
}

/** Test/audit hook: resets all in-memory queue and latch state. */
export function resetSteeringState() {
  items = []
  expectingBusy.clear()
}

/**
 * Consumes the next pending item for a session that just became idle with a
 * usable editor, arming the duplicate-dispatch latch. Returns undefined when
 * the session is busy, the editor is unavailable (permission/question prompt),
 * a dispatch is already in flight, or nothing is queued — an item is only ever
 * removed from the queue when it will actually be dispatched.
 */
export function acquireDispatch(
  sessionID: string,
  idle: boolean,
  editorUsable: boolean,
): PendingPrompt | undefined {
  if (!idle || !editorUsable || !steeringFlow.shouldDispatch(sessionID)) return undefined
  const item = pendingPrompts.take(sessionID)
  if (!item) return undefined
  steeringFlow.mark(sessionID)
  return item
}

/** Restores an item when its dispatch could not be started (e.g. no prompt ref). */
export function releaseDispatchFailed(item: PendingPrompt) {
  steeringFlow.settle(item.sessionID)
  pendingPrompts.add({ sessionID: item.sessionID, kind: item.kind, input: item.input, parts: item.parts })
}
