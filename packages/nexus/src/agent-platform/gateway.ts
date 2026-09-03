import { createHmac, createPublicKey, timingSafeEqual, verify } from "node:crypto"
import type { AgentPlatformStore, RunPolicy } from "./store"

export type GatewayInboundV1 = {
  schemaVersion: 1
  connectionId: string
  eventId: string
  senderId: string
  conversationId: string
}

function safelyEqual(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Verifies the Telegram secret header configured through setWebhook. */
export function verifyTelegramWebhook(input: { expectedSecret: string; receivedSecret?: string }) {
  return Boolean(input.receivedSecret) && safelyEqual(input.expectedSecret, input.receivedSecret!)
}

/** Verifies Slack v0 HMAC signatures over the unparsed request body. */
export function verifySlackRequest(input: {
  signingSecret: string
  rawBody: string
  timestamp?: string
  signature?: string
  now?: number
}) {
  if (!input.timestamp || !input.signature) return false
  const timestamp = Number(input.timestamp)
  if (!Number.isFinite(timestamp) || Math.abs((input.now ?? Date.now()) - timestamp * 1_000) > 5 * 60 * 1_000) return false
  const expected = `v0=${createHmac("sha256", input.signingSecret).update(`v0:${input.timestamp}:${input.rawBody}`).digest("hex")}`
  return safelyEqual(expected, input.signature)
}

/** Verifies a Discord HTTP-interaction Ed25519 signature using the raw request body. */
export function verifyDiscordInteraction(input: { publicKey: string; signature?: string; timestamp?: string; rawBody: string }) {
  if (!/^[a-f0-9]{64}$/i.test(input.publicKey) || !input.signature || !input.timestamp || !/^[a-f0-9]{128}$/i.test(input.signature)) return false
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(`302a300506032b6570032100${input.publicKey}`, "hex"),
      format: "der",
      type: "spki",
    })
    return verify(null, Buffer.from(`${input.timestamp}${input.rawBody}`), publicKey, Buffer.from(input.signature, "hex"))
  } catch {
    return false
  }
}

/**
 * Converts an already verified provider envelope into one bounded, durable
 * channel run. Provider secrets and raw request bodies are intentionally not
 * part of this hand-off.
 */
export function planGatewayRun(store: AgentPlatformStore, input: GatewayInboundV1 & { policy?: Partial<RunPolicy> }) {
  const reservation = store.reserveGatewayEvent(input)
  if (!reservation.accepted) return { reservation }
  const run = store.createRun({
    mode: "channel",
    idempotencyKey: `gateway:${input.connectionId}:${input.eventId}`,
    policy: input.policy,
  })
  return { reservation, run }
}
