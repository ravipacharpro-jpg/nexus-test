import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentPlatformStore } from "./store"
import { planGatewayRun } from "./gateway"

const roots: string[] = []

function makeStore() {
  const root = mkdtempSync(join(tmpdir(), "nexus-agent-platform-"))
  roots.push(root)
  return new AgentPlatformStore({ path: join(root, "agent-platform.db") })
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe("AgentPlatformStore", () => {
  test("stores scope-isolated redacted memory without duplicate active records", () => {
    const store = makeStore()
    const first = store.addMemory({ scope: "project", scopeId: "alpha", kind: "preference", content: "Use key sk-ant-api03-abcdefghij1234567890", confidence: 0.8 })
    const second = store.addMemory({ scope: "project", scopeId: "alpha", kind: "preference", content: "Use key sk-ant-api03-abcdefghij1234567890", confidence: 0.9 })
    expect(first.id).toBe(second.id)
    expect(first.content).not.toContain("sk-ant")
    expect(store.searchMemory("use key", "project", "alpha")).toHaveLength(1)
    expect(store.searchMemory("use key", "project", "beta")).toHaveLength(0)
    store.close()
  })

  test("replaces and tombstones memory without leaving stale active content", () => {
    const store = makeStore()
    const memory = store.addMemory({ scope: "device", scopeId: "default", kind: "fact", content: "Old preference", confidence: 0.5 })
    const replacement = store.replaceMemory(memory.id, { content: "New preference", confidence: 0.9 })
    expect(store.listMemory("device", "default").map((item) => item.content)).toEqual(["New preference"])
    store.deleteMemory(replacement.id)
    expect(store.listMemory("device", "default")).toHaveLength(0)
    store.close()
  })

  test("exports and imports only an explicit non-device memory scope", () => {
    const source = makeStore()
    source.addMemory({ scope: "project", scopeId: "alpha", kind: "decision", content: "Use a redacted sync pack", confidence: 0.8 })
    source.addMemory({ scope: "device", scopeId: "default", kind: "fact", content: "Do not sync this device-only preference", confidence: 0.8 })
    const pack = source.exportMemorySyncPack("project", "alpha")
    expect(pack.records).toHaveLength(1)
    expect(pack.records[0]?.content).toContain("redacted sync pack")

    const target = makeStore()
    expect(target.importMemorySyncPack(pack)).toHaveLength(1)
    expect(target.listMemory("project", "alpha")).toHaveLength(1)
    source.close()
    target.close()
  })

  test("records browser handoffs by redacted origin and requires explicit user checkpoints", () => {
    const store = makeStore()
    const handoff = store.createBrowserHandoff({ origin: "https://portal.example.test", purpose: "Continue after api_key=secret-value" })
    expect(handoff.origin).toBe("https://portal.example.test")
    expect(handoff.purpose).not.toContain("secret-value")
    expect(() => store.createBrowserHandoff({ origin: "https://portal.example.test/login?token=secret", purpose: "login" })).toThrow("origin")
    expect(() => store.transitionBrowserHandoff(handoff.id, "complete")).toThrow("must be resumed")
    expect(store.transitionBrowserHandoff(handoff.id, "resume").status).toBe("resumed")
    expect(store.transitionBrowserHandoff(handoff.id, "complete").status).toBe("completed_by_user")
    store.close()
  })

  test("keeps learning proposed until an explicit approval creates a skill revision", () => {
    const store = makeStore()
    const proposal = store.proposeLearning({ runId: "run-1", title: "Safe API checks", summary: "Mask keys", skillDraft: "Always mask api_key=secret", evidence: ["api_key=secret"] })
    expect(store.listLearning("proposed")).toHaveLength(1)
    store.approveLearning(proposal.id)
    expect(store.listLearning("approved")).toHaveLength(1)
    expect(store.listLearning("approved")[0]?.skillDraft).not.toContain("api_key=secret")
    store.close()
  })

  test("lists approved skills and revokes them explicitly", () => {
    const store = makeStore()
    const proposal = store.proposeLearning({ runId: "run-2", title: "Review safely", summary: "", skillDraft: "Do not expose secrets" })
    store.approveLearning(proposal.id)
    const revision = store.listSkillRevisions()[0]
    expect(revision?.title).toBe("Review safely")
    store.revokeSkillRevision(revision!.id)
    expect(store.listSkillRevisions()).toHaveLength(0)
    expect(store.listLearning("superseded")[0]?.id).toBe(proposal.id)
    store.close()
  })

  test("creates disabled schedules that require a later explicit enable action", () => {
    const store = makeStore()
    const schedule = store.createSchedule({ name: "daily-review", expression: "0 9 * * *", payload: "review project" })
    expect(schedule.enabled).toBe(false)
    expect(store.listSchedules()[0]?.enabled).toBe(false)
    store.close()
  })

  test("records bounded durable subagent plans without starting background work", () => {
    const store = makeStore()
    const first = store.createRun({ idempotencyKey: "interactive:demo", policy: { maxChildren: 2, maxParallel: 3, budgetClass: "low" } })
    const replay = store.createRun({ idempotencyKey: "interactive:demo", policy: { maxChildren: 12, maxParallel: 12 } })
    expect(first.id).toBe(replay.id)
    expect(first.status).toBe("queued")
    expect(first.policy).toEqual({ maxChildren: 2, maxParallel: 3, budgetClass: "low" })
    expect(store.listRuns()).toHaveLength(1)
    store.close()
  })

  test("keeps gateway connections disabled until explicitly enabled and rejects unauthorized or duplicate events", () => {
    const store = makeStore()
    expect(() => store.registerGatewayConnection({ channel: "telegram", label: "personal", credentialRef: "12345:raw-token", allowedSenders: ["user-1"] })).toThrow("credential://")
    const connection = store.registerGatewayConnection({ channel: "telegram", label: "personal", credentialRef: "credential://telegram/personal", allowedSenders: ["user-1"] })
    expect(connection.runtimeMode).toBe("local")
    expect(store.reserveGatewayEvent({ connectionId: connection.id, eventId: "42", senderId: "user-1", conversationId: "chat-1" })).toEqual({ accepted: false, reason: "connection_disabled" })
    store.setGatewayConnectionEnabled(connection.id, true)
    expect(store.reserveGatewayEvent({ connectionId: connection.id, eventId: "42", senderId: "user-2", conversationId: "chat-1" })).toEqual({ accepted: false, reason: "sender_not_allowed" })
    expect(planGatewayRun(store, { schemaVersion: 1, connectionId: connection.id, eventId: "42", senderId: "user-1", conversationId: "chat-1" }).run?.mode).toBe("channel")
    expect(store.reserveGatewayEvent({ connectionId: connection.id, eventId: "42", senderId: "user-1", conversationId: "chat-1" })).toEqual({ accepted: false, reason: "duplicate" })
    expect(store.listRuns()).toHaveLength(1)
    store.close()
  })

  test("keeps a hosted gateway profile opt-in instead of making it the local default", () => {
    const store = makeStore()
    const connection = store.registerGatewayConnection({ channel: "discord", label: "custom-host", runtimeMode: "hosted", credentialRef: "credential://discord/custom-host", allowedSenders: ["owner"] })
    expect(connection.runtimeMode).toBe("hosted")
    expect(store.listGatewayConnections()[0]?.runtimeMode).toBe("hosted")
    store.close()
  })

  test("claims an enabled schedule window once and requires explicit confirmation before enablement", () => {
    const store = makeStore()
    const schedule = store.createSchedule({ name: "gateway-review", expression: "0 9 * * *", payload: "review project" })
    expect(() => store.setScheduleEnabled(schedule.id, { enabled: true, confirmed: false })).toThrow("explicit confirmation")
    store.setScheduleEnabled(schedule.id, { enabled: true, confirmed: true })
    expect(store.claimScheduleExecution({ scheduleId: schedule.id, scheduledWindow: "2026-08-24T09:00:00Z" }).claimed).toBe(true)
    expect(store.claimScheduleExecution({ scheduleId: schedule.id, scheduledWindow: "2026-08-24T09:00:00Z" }).claimed).toBe(false)
    store.close()
  })
})
