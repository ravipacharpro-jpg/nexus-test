import {
  classifySteering,
  STEERING_ACK,
  steeringStatusLine,
  stripStopPhrase,
  type SteeringKind,
} from "./steering"
/**
 * Framework-agnostic active-task steering coordinator. Given a message typed
 * while a task runs, it classifies locally and drives the required side
 * effects through injected dependencies, so the full session-path behavior
 * (acknowledgement, cancellation, queueing, dialog choice) can be exercised
 * deterministically without a renderer or network.
 */

export type SteerAction = "status" | "stop" | "change-replace" | "change-queue" | "change-dismissed" | "followup"

export type SteerResult = {
  action: SteerAction
  /** Whether the explicit cancellation path ran to completion. */
  aborted: boolean
  /** How many items were added to the pending queue. */
  queued: number
}

export type SteerablePrompt = {
  kind: "next" | "followup"
  input: string
  parts: readonly unknown[]
}

export type SteeringDeps = {
  /** Redacted activity stage of the running turn; existing categories only. */
  currentStage(): string | undefined
  /** The existing explicit cancellation path. Rejects or resolves on failure. */
  abort(): Promise<unknown>
  /** Fixed redacted acknowledgement channel. */
  ack(message: string): void
  /** Error surface for a failed cancellation attempt. */
  abortFailed(error: unknown): void
  /** Explicit cancel-and-replace vs keep-and-queue choice; undefined means dismissed. */
  askChangeChoice(): Promise<"replace" | "queue" | undefined>
  enqueue(item: SteerablePrompt): void
  clearInput(): void
}

export async function steerActiveTask(text: string, parts: readonly unknown[], deps: SteeringDeps): Promise<SteerResult> {
  const kind: SteeringKind = classifySteering(text)

  if (kind === "status") {
    deps.ack(steeringStatusLine(deps.currentStage()))
    return { action: "status", aborted: false, queued: 0 }
  }

  if (kind === "stop") {
    // Acknowledge immediately, before awaiting the abort: a slow cancellation
    // must never delay the promised local response. If the abort then fails,
    // nothing is queued or cleared, so no phantom prompt can fire and the
    // editor keeps the user's text.
    deps.ack(STEERING_ACK.stop)
    const aborted = await performAbort(deps)
    if (!aborted) return { action: "stop", aborted: false, queued: 0 }
    const remainder = stripStopPhrase(text)
    if (remainder) deps.enqueue({ kind: "next", input: remainder, parts })
    deps.clearInput()
    return { action: "stop", aborted: true, queued: remainder ? 1 : 0 }
  }

  if (kind === "change") {
    deps.ack(STEERING_ACK.change)
    const choice = await deps.askChangeChoice()
    if (!choice) return { action: "change-dismissed", aborted: false, queued: 0 }
    if (choice === "replace") {
      const aborted = await performAbort(deps)
      if (!aborted) return { action: "change-replace", aborted: false, queued: 0 }
      deps.enqueue({ kind: "next", input: text, parts })
      deps.clearInput()
      return { action: "change-replace", aborted: true, queued: 1 }
    }
    // Yield once after the acknowledgement so the TUI can paint it before the
    // queue mutation changes the session surface.
    await yieldForRender()
    deps.enqueue({ kind: "followup", input: text, parts })
    deps.clearInput()
    return { action: "change-queue", aborted: false, queued: 1 }
  }

  // Acknowledge synchronously before any side effect: the user's message must
  // produce a visible local response before queue writes or awaited work.
  deps.ack(STEERING_ACK.followup)
  // Do not let the queue write occupy the same render turn as the local ack.
  await yieldForRender()
  deps.enqueue({ kind: "followup", input: text, parts })
  deps.clearInput()
  return { action: "followup", aborted: false, queued: 1 }
}

function yieldForRender() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function performAbort(deps: SteeringDeps): Promise<boolean> {
  try {
    await deps.abort()
    return true
  } catch (error) {
    deps.abortFailed(error)
    return false
  }
}
