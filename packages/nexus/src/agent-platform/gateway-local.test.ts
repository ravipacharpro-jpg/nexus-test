import { createHmac } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pollTelegramOnce, readLocalGatewayState, startLocalGatewayServer } from "./gateway-local"
import { AgentPlatformStore } from "./store"

const roots: string[] = []

function makeStore() {
  const root = mkdtempSync(join(tmpdir(), "nexus-gateway-local-"))
  roots.push(root)
  return { root, store: new AgentPlatformStore({ path: join(root, "agent-platform.db") }) }
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe("local gateway", () => {
  test("accepts only a signed allowlisted Telegram message over a loopback listener", async () => {
    const { root, store } = makeStore()
    const connection = store.registerGatewayConnection({ channel: "telegram", label: "local", credentialRef: "credential://local/telegram", allowedSenders: ["owner-1"] })
    store.setGatewayConnectionEnabled(connection.id, true)
    const runtime = await startLocalGatewayServer({ store, statePath: join(root, "state.json"), credentialFor: () => "verify-secret" })
    const endpoint = `http://${runtime.state.host}:${runtime.state.port}/v1/gateway/telegram/${connection.id}`
    const body = JSON.stringify({ update_id: 42, message: { from: { id: "owner-1" }, chat: { id: "chat-1" }, text: "do not persist this raw text" } })
    const accepted = await fetch(endpoint, { method: "POST", headers: { "x-telegram-bot-api-secret-token": "verify-secret" }, body })
    expect(accepted.status).toBe(202)
    expect(store.listRuns()).toHaveLength(1)
    const rejected = await fetch(endpoint, { method: "POST", headers: { "x-telegram-bot-api-secret-token": "wrong" }, body })
    expect(rejected.status).toBe(401)
    expect(store.listRuns()).toHaveLength(1)
    await runtime.close()
    store.close()
  })

  test("uses Telegram long polling only when explicitly invoked and advances the offset", async () => {
    const received: string[] = []
    const result = await pollTelegramOnce({
      token: "not-a-real-token",
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, result: [{ update_id: 7, message: { from: { id: "owner" }, chat: { id: "chat" } } }] })),
      onUpdate: (event) => received.push(event.eventId),
    })
    expect(result).toEqual({ nextOffset: 8, accepted: 1 })
    expect(received).toEqual(["7"])
  })

  test("accepts only a current Slack signed event over the local listener", async () => {
    const { root, store } = makeStore()
    const connection = store.registerGatewayConnection({ channel: "slack", label: "local", credentialRef: "credential://local/slack", allowedSenders: ["owner-1"] })
    store.setGatewayConnectionEnabled(connection.id, true)
    const runtime = await startLocalGatewayServer({ store, statePath: join(root, "state.json"), credentialFor: () => "local-secret" })
    const timestamp = String(Math.floor(Date.now() / 1_000))
    const rawBody = JSON.stringify({ event_id: "event-1", event: { user: "owner-1", channel: "channel-1" } })
    const signature = `v0=${createHmac("sha256", "local-secret").update(`v0:${timestamp}:${rawBody}`).digest("hex")}`
    const response = await fetch(`http://${runtime.state.host}:${runtime.state.port}/v1/gateway/slack/${connection.id}`, {
      method: "POST",
      headers: { "x-slack-request-timestamp": timestamp, "x-slack-signature": signature },
      body: rawBody,
    })
    expect(response.status).toBe(202)
    expect(store.listRuns()).toHaveLength(1)
    await runtime.close()
    store.close()
  })

  test("does not expose an explicitly hosted connection through the local listener", async () => {
    const { root, store } = makeStore()
    const connection = store.registerGatewayConnection({ channel: "telegram", label: "hosted", runtimeMode: "hosted", credentialRef: "credential://hosted/telegram", allowedSenders: ["owner-1"] })
    store.setGatewayConnectionEnabled(connection.id, true)
    const runtime = await startLocalGatewayServer({ store, statePath: join(root, "state.json"), credentialFor: () => "verify-secret" })
    const response = await fetch(`http://${runtime.state.host}:${runtime.state.port}/v1/gateway/telegram/${connection.id}`, {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "verify-secret" },
      body: JSON.stringify({ update_id: 1, message: { from: { id: "owner-1" }, chat: { id: "chat-1" } } }),
    })
    expect(response.status).toBe(404)
    await runtime.close()
    store.close()
  })

  test("replaces a confirmed-stale local state file rather than blocking a fresh foreground start", async () => {
    const { root, store } = makeStore()
    const statePath = join(root, "state.json")
    await Bun.write(statePath, JSON.stringify({ version: 1, pid: 999_999, host: "127.0.0.1", port: 8787, startedAt: 0 }))
    const runtime = await startLocalGatewayServer({ store, statePath, credentialFor: () => undefined })
    expect(readLocalGatewayState(statePath)?.pid).toBe(process.pid)
    await runtime.close()
    expect(readLocalGatewayState(statePath)).toBeUndefined()
    store.close()
  })
})
