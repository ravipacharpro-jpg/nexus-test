import { beforeEach, expect, test } from "bun:test"
import {
  acquireDispatch,
  pendingPrompts,
  releaseDispatchFailed,
  resetSteeringState,
  steeringFlow,
} from "../../src/prompt/steering-queue"

// Clean scoped setup: every test starts from identical empty state, and the
// tested module has zero package dependencies so it resolves identically in
// any isolated audit worktree.
beforeEach(() => resetSteeringState())

// Unique session IDs per test keep the queue isolated even without resets.
const sid = () => `ses_${crypto.randomUUID()}`

test("queue is FIFO per session and sessions stay isolated", () => {
  const a = sid()
  const b = sid()
  pendingPrompts.add({ sessionID: a, kind: "followup", input: "first", parts: [] })
  pendingPrompts.add({ sessionID: a, kind: "next", input: "second", parts: [] })
  pendingPrompts.add({ sessionID: b, kind: "followup", input: "other", parts: [] })

  expect(pendingPrompts.list(a).map((item) => item.input)).toEqual(["first", "second"])
  const taken = pendingPrompts.take(a)
  expect(taken?.input).toBe("first")
  expect(pendingPrompts.list(a).map((item) => item.input)).toEqual(["second"])
  expect(pendingPrompts.list(b).map((item) => item.input)).toEqual(["other"])
})

test("remove drops only the targeted entry and take on empty returns undefined", () => {
  const a = sid()
  const first = pendingPrompts.add({ sessionID: a, kind: "followup", input: "keep me editable", parts: [] })
  const dropped = pendingPrompts.add({ sessionID: a, kind: "followup", input: "drop me", parts: [] })
  pendingPrompts.remove(dropped.id)
  expect(pendingPrompts.list(a).length).toBe(1)
  expect(pendingPrompts.list(a)[0]?.id).toBe(first.id)
  pendingPrompts.remove(first.id)
  expect(pendingPrompts.list(a).length).toBe(0)
  expect(pendingPrompts.take(a)).toBeUndefined()
})

test("subscribers are notified on every mutation", () => {
  let notifications = 0
  const off = pendingPrompts.subscribe(() => {
    notifications += 1
  })
  const a = sid()
  const added = pendingPrompts.add({ sessionID: a, kind: "followup", input: "watched", parts: [] })
  pendingPrompts.remove(added.id)
  expect(notifications).toBe(2)
  off()
  pendingPrompts.add({ sessionID: a, kind: "followup", input: "unwatched", parts: [] })
  expect(notifications).toBe(2)
})

test("dispatch latch prevents double dispatch until busy is observed", () => {
  const a = sid()
  expect(steeringFlow.shouldDispatch(a)).toBe(true)
  steeringFlow.mark(a)
  expect(steeringFlow.shouldDispatch(a)).toBe(false)
  steeringFlow.settle(a)
  expect(steeringFlow.shouldDispatch(a)).toBe(true)
})

test("acquireDispatch consumes exactly one item per idle transition", () => {
  const a = sid()
  pendingPrompts.add({ sessionID: a, kind: "followup", input: "one", parts: [] })
  pendingPrompts.add({ sessionID: a, kind: "followup", input: "two", parts: [] })

  const first = acquireDispatch(a, true, true)
  expect(first?.input).toBe("one")
  // Latch is armed: an immediate second acquire (lagging idle event) is refused.
  expect(acquireDispatch(a, true, true)).toBeUndefined()
  // Session observed busy again → next idle transition may dispatch "two".
  steeringFlow.settle(a)
  const second = acquireDispatch(a, true, true)
  expect(second?.input).toBe("two")
  if (second) releaseDispatchFailed(second)
})

test("acquireDispatch refuses busy sessions and blocked editors without consuming items", () => {
  for (const [idle, editor] of [
    [false, true],
    [true, false],
    [false, false],
  ] as const) {
    const a = sid()
    const kept = pendingPrompts.add({ sessionID: a, kind: "next", input: "survives", parts: [] })
    expect(acquireDispatch(a, idle, editor)).toBeUndefined()
    // Nothing was removed from the queue — no phantom loss.
    expect(pendingPrompts.list(a).map((item) => item.id)).toEqual([kept.id])
  }
})

test("releaseDispatchFailed restores the item and clears the latch", () => {
  const a = sid()
  pendingPrompts.add({ sessionID: a, kind: "next", input: "retry me", parts: [] })
  const item = acquireDispatch(a, true, true)!
  expect(item.input).toBe("retry me")
  releaseDispatchFailed(item)
  expect(steeringFlow.shouldDispatch(a)).toBe(true)
  expect(pendingPrompts.list(a).length).toBe(1)
  expect(pendingPrompts.take(a)?.input).toBe("retry me")
})

test("queued entries carry the full prompt payload intact", () => {
  const a = sid()
  const parts = [{ type: "file" as const, mime: "text/plain", filename: "note.txt" }]
  pendingPrompts.add({ sessionID: a, kind: "next", input: "run checks\nwith detail", parts })
  const [item] = pendingPrompts.list(a)
  expect(item?.kind).toBe("next")
  expect(item?.input).toBe("run checks\nwith detail")
  expect(item?.parts).toEqual(parts)
})
