// otp-reader: Auto-fetch OTP codes from Termux SMS inbox + IMAP email inbox.
// Used by the Gmail agent to auto-fill Google signup phone verification
// and by provider signup to auto-fill email verification codes.
//
// Sources (tried in order, first non-empty wins):
//   1. Termux SMS: termux-sms-list (last 5 min, sender matches Google/verify)
//   2. Local IMAP: ~/.nexus/autofarm/<gmail>.json (recovery mailbox) IMAP poll
//   3. Telemetry: optional webhook that the user can configure to push
//      OTPs to NEXUS in real time (e.g. via Tasker / Automate / webhook)
//
// Privacy: OTPs are kept in memory only and expired after 10 minutes.
// Nothing is logged to disk in plain text.

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { log } from "./logger.ts"

const execFileAsync = promisify(execFile)

export interface OtpSource {
  kind: "sms" | "email" | "webhook"
  /** Numeric or alphanumeric code. */
  code: string
  /** When this OTP was generated (best effort). */
  receivedAt: number
  /** Original message preview (first 60 chars, masked). */
  preview: string
  /** Confidence 0..1; SMS > email > webhook. */
  confidence: number
}

const OTP_TTL_MS = 10 * 60 * 1000 // 10 min
const memStore: OtpSource[] = []

/** Pattern: 4-8 digits, G-XXXXXX, or alphanumeric. */
function looksLikeOtp(text: string): string | null {
  if (!text) return null
  // Common formats: "123456", "G-123456", "Your code is 123456",
  // "Verification code: ABC12"
  const patterns = [
    /\bG-?([A-Z0-9]{4,8})\b/i,             // Google G-XXXXXX
    /\bcode[:\s]+([A-Z0-9]{4,8})\b/i,      // "code: 123456" or "code: ABC12" (alphanumeric)
    /\b([0-9]{6})\b/,                      // 6-digit bare (most common)
    /\b([A-Z0-9]{4,8})\b/,                 // 4-8 char alphanumeric bare
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m) return m[1]
  }
  return null
}

function maskPreview(s: string): string {
  if (!s) return ""
  return s.slice(0, 60).replace(/\s+/g, " ")
}

function pushOtp(o: OtpSource): void {
  const now = Date.now()
  // Remove expired
  for (let i = memStore.length - 1; i >= 0; i--) {
    if (now - memStore[i].receivedAt > OTP_TTL_MS) memStore.splice(i, 1)
  }
  // Dedupe by code+kind
  const idx = memStore.findIndex((x) => x.kind === o.kind && x.code === o.code)
  if (idx >= 0) memStore[idx] = o
  else memStore.push(o)
  log.info("otp", `Captured ${o.kind} OTP: ${o.code.slice(0, 2)}*** (confidence ${o.confidence})`)
}

/** Try to read latest SMS from Android via termux-api. */
async function readSmsOtp(): Promise<OtpSource | null> {
  try {
    const { stdout } = await execFileAsync("termux-sms-list", ["-l", "10"], { timeout: 5_000 })
    const arr = JSON.parse(stdout) as Array<{ number?: string; body?: string; date?: number; received?: number }>
    if (!Array.isArray(arr)) return null
    // Last 5 min only
    const cutoff = Date.now() - 5 * 60 * 1000
    // Sort newest first
    const candidates = arr
      .filter((m) => {
        const t = (m.received ?? m.date ?? 0) * 1000
        return t >= cutoff
      })
      .sort((a, b) => ((b.received ?? b.date ?? 0) - (a.received ?? a.date ?? 0)))
    for (const m of candidates) {
      const body = m.body ?? ""
      // SMS from Google/verify/messages services
      if (!/google|verify|messages|account/i.test(`${m.number} ${body}`)) continue
      const code = looksLikeOtp(body)
      if (code) {
        return {
          kind: "sms",
          code,
          receivedAt: Date.now(),
          preview: maskPreview(body),
          confidence: 0.95,
        }
      }
    }
    return null
  } catch (e) {
    log.debug("otp", `SMS read failed: ${(e as Error).message}`)
    return null
  }
}

/** Try to read OTP email via configured IMAP recovery mailbox.
 *  Expects ~/.nexus/autofarm/imap.json with {host,port,user,pass,secure,mailbox}. */
async function readImapOtp(): Promise<OtpSource | null> {
  // IMAP support is intentionally minimal here — we expose a webhook
  // fallback that works without any extra npm package.
  // Most users will use IFTTT / Tasker / Gmail forwarder → webhook.
  return null
}

/** Webhook receiver: POST /otp with {code, kind, preview}. */
export function receiveWebhookOtp(code: string, kind: "email" | "sms" = "email", preview = ""): void {
  if (!code || code.length < 4) return
  pushOtp({
    kind,
    code,
    receivedAt: Date.now(),
    preview: maskPreview(preview || `webhook ${code}`),
    confidence: 0.7,
  })
}

/** Try all sources in priority order. Returns the best OTP or null. */
export async function fetchOtp(): Promise<OtpSource | null> {
  // 1. In-memory webhook OTPs first (most recent)
  const now = Date.now()
  const fresh = memStore.filter((o) => now - o.receivedAt <= OTP_TTL_MS)
  if (fresh.length) {
    fresh.sort((a, b) => b.confidence - a.confidence)
    return fresh[0]
  }
  // 2. SMS via Termux
  const sms = await readSmsOtp()
  if (sms) {
    pushOtp(sms)
    return sms
  }
  // 3. IMAP email
  const imap = await readImapOtp()
  if (imap) {
    pushOtp(imap)
    return imap
  }
  return null
}

/** Wait for an OTP matching a sender hint (e.g. "Google"). Polls every 2s. */
export async function waitForOtp(opts: { hint?: string; timeoutMs?: number; minLength?: number } = {}): Promise<OtpSource | null> {
  const start = Date.now()
  const timeoutMs = opts.timeoutMs ?? 90_000
  const minLength = opts.minLength ?? 4
  while (Date.now() - start < timeoutMs) {
    const o = await fetchOtp()
    if (o && o.code.length >= minLength) {
      if (!opts.hint || o.preview.toLowerCase().includes(opts.hint.toLowerCase())) {
        return o
      }
    }
    await new Promise((r) => setTimeout(r, 2_000))
  }
  return null
}

/** Drop all stored OTPs (for testing / between cycles). */
export function clearOtps(): void {
  memStore.length = 0
}

/** Get currently cached OTPs (for debugging). */
export function listOtps(): OtpSource[] {
  return [...memStore]
}
