// silent-queue: tracks pending messages in memory so the agent can
// process them in order, but does NOT display any queue/pending UI.
// This replaces the NEXUS TUI's old "x messages in queue" popup.
//
// Design:
//   - Pending messages are stored in a simple FIFO list
//   - Drained automatically as the agent processes them
//   - Stats are available programmatically (for /status, metrics, etc.)
//   - NO display methods, NO push notifications
//
// The agent loop should:
//   1. user sends message -> enqueueSilent()
//   2. agent starts processing -> dequeueSilent()
//   3. process message
//   4. repeat
//
// Optionally, the TUI can poll stats() to show a quiet "..." status.

import { log } from "./logger.ts"

export interface QueuedMessage {
  id: string
  text: string
  enqueuedAt: number
  /** Estimated time the user has been waiting. */
  waitingMs: number
}

export interface QueueStats {
  pending: number
  totalEnqueued: number
  totalProcessed: number
  averageWaitMs: number
  oldestWaitingMs: number
}

const QUEUE: QueuedMessage[] = []
let totalEnqueued = 0
let totalProcessed = 0
let totalWaitMs = 0
let counter = 0

function newId(): string {
  counter++
  return `q${Date.now().toString(36)}${counter}`
}

/** Add a message to the silent queue. */
export function enqueueSilent(text: string): QueuedMessage {
  const msg: QueuedMessage = {
    id: newId(),
    text,
    enqueuedAt: Date.now(),
    waitingMs: 0,
  }
  QUEUE.push(msg)
  totalEnqueued++
  log.debug("queue", `enqueued id=${msg.id} (${QUEUE.length} pending)`)
  return msg
}

/** Take the next message off the queue. Returns null if empty. */
export function dequeueSilent(): QueuedMessage | null {
  const msg = QUEUE.shift()
  if (msg) {
    const waited = Date.now() - msg.enqueuedAt
    msg.waitingMs = waited
    totalWaitMs += waited
    totalProcessed++
    log.debug("queue", `dequeued id=${msg.id} (waited ${waited}ms)`)
  }
  return msg
}

/** Peek at the next message without removing it. */
export function peekSilent(): QueuedMessage | null {
  return QUEUE[0] ?? null
}

/** Get current queue statistics (no display, just programmatic). */
export function queueStats(): QueueStats {
  const now = Date.now()
  const oldest = QUEUE[0]
  return {
    pending: QUEUE.length,
    totalEnqueued,
    totalProcessed,
    averageWaitMs: totalProcessed > 0 ? totalWaitMs / totalProcessed : 0,
    oldestWaitingMs: oldest ? now - oldest.enqueuedAt : 0,
  }
}

/** Drop all pending messages (e.g. on agent restart). */
export function clearSilent(): number {
  const n = QUEUE.length
  QUEUE.length = 0
  log.info("queue", `cleared ${n} pending messages`)
  return n
}

/** Get a snapshot of pending messages (for debugging only). */
export function listSilent(): QueuedMessage[] {
  return [...QUEUE]
}

/**
 * Convenience wrapper: run a worker function for each queued message.
 * The worker is called sequentially (FIFO). If the queue is empty, this
 * is a no-op. No UI, no logging beyond debug.
 */
export async function drainSilent(
  worker: (msg: QueuedMessage) => Promise<void>,
  opts: { maxPerDrain?: number; yieldMs?: number } = {},
): Promise<number> {
  const max = opts.maxPerDrain ?? Infinity
  const yieldMs = opts.yieldMs ?? 10
  let processed = 0
  while (processed < max) {
    const msg = dequeueSilent()
    if (!msg) break
    try {
      await worker(msg)
    } catch (e) {
      log.error("queue", `worker failed for id=${msg.id}: ${(e as Error).message}`)
    }
    processed++
    // Yield to event loop
    await new Promise((r) => setTimeout(r, yieldMs))
  }
  return processed
}
