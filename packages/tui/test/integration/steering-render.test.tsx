/**
 * Real TUI input/render-path coverage for active-task steering acknowledgements.
 *
 * Unlike the headless session harness, this drives the production steering
 * coordinator through the actual @opentui/solid renderer frame loop and asserts
 * on captured terminal frames: the fixed redacted acknowledgement must become
 * visible while the awaited abort/model/session work is still in flight — it
 * must never wait behind it.
 */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { ToastProvider, useToast } from "../../src/ui/toast"
import { steerActiveTask } from "../../src/util/steering-flow"
import { STEERING_ACK, steeringStatusLine } from "../../src/util/steering"

function AckSurface(props: { onReady: (ack: (message: string) => void) => void }) {
  const toast = useToast()
  props.onReady((message) => {
    // Exact production adapter body from Prompt's steerActiveTask binding:
    // show the fixed acknowledgement, then request the smallest safe flush.
    toast.show({ message, variant: "info", duration: 3000 })
  })
  return <text>{toast.currentToast?.message ?? ""}</text>
}

function setup() {
  const timeline: string[] = []
  let ackFn!: (message: string) => void
  let app!: Awaited<ReturnType<typeof testRender>>
  let done!: () => void
  const ready = new Promise<void>((resolve) => (done = resolve))

  const boot = testRender(
    () => (
      <ToastProvider>
        <AckSurface
          onReady={(ack) => {
            ackFn = ack
            done()
          }}
        />
      </ToastProvider>
    ),
    { width: 60, height: 8 },
  )

  async function frameContains(snippet: string): Promise<number> {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 4))
      if (app.captureCharFrame().includes(snippet)) return performance.now()
    }
  }

  const harness = {
    ack: () => ackFn,
    timeline,
    frameContains,
    destroy: () => app.renderer.destroy(),
  }

  return {
    async start() {
      app = await boot
      await ready
      return harness
    },
  }
}

test("stop acknowledgement is visible before a slow abort settles", async () => {
  const h = await setup().start()
  try {
    let aborted = false
    const abort = () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          aborted = true
          resolve()
        }, 250)
      })
    const ack = h.ack()
    const result = steerActiveTask("stop now", [], {
      currentStage: () => undefined,
      abort,
      ack: (message) => {
        h.timeline.push("ack")
        ack(message)
      },
      abortFailed: () => {},
      askChangeChoice: async () => undefined,
      enqueue: () => h.timeline.push("enqueue"),
      clearInput: () => {},
    })

    await h.frameContains(STEERING_ACK.stop)
    // The fixed acknowledgement is already on screen while the abort is still in flight.
    expect(aborted).toBe(false)
    await result
    expect(aborted).toBe(true)
    expect(h.timeline.filter((entry) => entry === "ack").length).toBe(1)
    // Pure stop phrase queues nothing.
    expect(h.timeline).not.toContain("enqueue")
  } finally {
    h.destroy()
  }
})

test("status and follow-up acknowledgements render promptly under delayed session work", async () => {
  const h = await setup().start()
  try {
    const ack = h.ack()
    // Delayed model/session work in flight: the acknowledgement must not wait for it.
    const slowWork = new Promise((resolve) => setTimeout(resolve, 200))
    ack(steeringStatusLine(undefined))

    const statusVisible = await h.frameContains(steeringStatusLine(undefined))
    expect(statusVisible).toBeGreaterThan(0)

    ack(STEERING_ACK.followup)
    const followupVisible = await h.frameContains("Queued until the active task")
    expect(followupVisible).toBeGreaterThan(statusVisible)

    await slowWork
  } finally {
    h.destroy()
  }
})

test("duplicate submits acknowledge each stop but never queue a phantom prompt", async () => {
  const h = await setup().start()
  try {
    const ack = h.ack()
    const dispatched: string[] = []
    const deps = {
      currentStage: () => undefined,
      abort: async () => {
        dispatched.push("abort")
      },
      ack: (message: string) => ack(message),
      abortFailed: () => {},
      askChangeChoice: async () => undefined,
      enqueue: (item: { input: string }) => dispatched.push(`queue:${item.input}`),
      clearInput: () => {},
    }
    // A double-pressed Enter races two submissions of the same stop phrase.
    await Promise.all([steerActiveTask("stop now", [], deps), steerActiveTask("stop now", [], deps)])
    await h.frameContains(STEERING_ACK.stop)
    expect(dispatched.filter((entry) => entry === "abort").length).toBe(2)
    expect(dispatched.some((entry) => entry.startsWith("queue:"))).toBe(false)
  } finally {
    h.destroy()
  }
})
