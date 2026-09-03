import { createHmac, generateKeyPairSync, sign } from "node:crypto"
import { verifyDiscordInteraction, verifySlackRequest, verifyTelegramWebhook } from "./gateway"

describe("gateway verification", () => {
  test("validates a Telegram webhook secret without accepting a mismatched header", () => {
    expect(verifyTelegramWebhook({ expectedSecret: "nexus-secret", receivedSecret: "nexus-secret" })).toBe(true)
    expect(verifyTelegramWebhook({ expectedSecret: "nexus-secret", receivedSecret: "different" })).toBe(false)
  })

  test("validates Slack raw-body HMAC and rejects stale timestamps", () => {
    const timestamp = "1724490000"
    const rawBody = "command=%2Fnexus&text=status"
    const signature = `v0=${createHmac("sha256", "slack-secret").update(`v0:${timestamp}:${rawBody}`).digest("hex")}`
    expect(verifySlackRequest({ signingSecret: "slack-secret", rawBody, timestamp, signature, now: 1_724_490_000_000 })).toBe(true)
    expect(verifySlackRequest({ signingSecret: "slack-secret", rawBody, timestamp, signature, now: 1_724_490_301_000 })).toBe(false)
  })

  test("validates Discord Ed25519 signatures over the timestamp and raw body", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519")
    const rawBody = '{"type":1}'
    const timestamp = "1724490000"
    const signature = sign(null, Buffer.from(`${timestamp}${rawBody}`), privateKey).toString("hex")
    const publicKeyHex = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex")
    expect(verifyDiscordInteraction({ publicKey: publicKeyHex, signature, timestamp, rawBody })).toBe(true)
    expect(verifyDiscordInteraction({ publicKey: publicKeyHex, signature, timestamp, rawBody: '{"type":2}' })).toBe(false)
  })
})
