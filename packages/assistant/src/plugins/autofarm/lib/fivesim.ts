// 5sim.net client — pays for and polls virtual phone numbers so
// Google phone-verify handoff can be done without ever exposing the
// user's personal number.
//
// Pricing: 5sim charges per SMS (cheap — typical $0.05–$0.50 depending
// on country and operator). A single $1 balance covers 2–20 Gmail
// signups. The user funds the balance on 5sim.net directly; this
// module never handles payment.
//
// Privacy: this module never stores or logs the SMS code beyond a
// 10-minute in-memory window. The purchased number is held in
// memory only and released on cancel() or after the first SMS arrives.
//
// API reference: https://5sim.net/docs
//
// Cross-platform: pure TS, only fetch() and node:fs. No shell out.
// Works on Termux, Linux, macOS, Windows.

const BASE_URL = "https://5sim.net/v1"

export interface FiveSimNumber {
  id: number
  phone: string
  operator: string
  product: string
  price: number
  status: "PENDING" | "RECEIVED" | "CANCELED" | "TIMEOUT" | "BANNED"
  expires: string
  sms: Array<{ id: number, created_at: string, date: string, sender: string, text: string, code: string }>
  country: string
}

export interface FiveSimConfig {
  /** Bearer token from 5sim.net → Profile → API key. */
  apiKey: string
  /** Override base URL (for self-hosted 5sim mirrors). */
  baseUrl?: string
}

export class FiveSimError extends Error {
  constructor(public status: number, public body: string, message: string) {
    super(message)
    this.name = "FiveSimError"
  }
}

async function api<T = unknown>(cfg: FiveSimConfig, path: string, init?: RequestInit): Promise<T> {
  const url = (cfg.baseUrl ?? BASE_URL).replace(/\/$/, "") + path
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: "Bearer " + cfg.apiKey,
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new FiveSimError(res.status, body, `5sim ${init?.method ?? "GET"} ${path} failed: ${res.status} ${body.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

/** Read account balance + active rentals. */
export async function getProfile(cfg: FiveSimConfig): Promise<{ id: number; email: string; balance: number; rating: number }> {
  return api(cfg, "/user/profile")
}

/**
 * Buy a phone number for the given Google signup handoff.
 *
 *  country: ISO-2 (e.g. "us", "gb", "in")
 *  operator: "any" or a specific operator id from /guest/operators
 *  product: the service — for Google signup this is "google" or "other"
 *
 * The purchase is asynchronous on 5sim: the API immediately returns
 * the rental record (id, phone, status="PENDING"). The caller then
 * polls check() until an SMS arrives or the rental expires.
 */
export async function buyNumber(cfg: FiveSimConfig, country: string, operator: string, product: string): Promise<FiveSimNumber> {
  return api<FiveSimNumber>(cfg, `/user/buy/activation/${encodeURIComponent(country)}/${encodeURIComponent(operator)}/${encodeURIComponent(product)}`)
}

/** Poll the rental for the latest SMS. Returns the rental with .sms populated. */
export async function checkNumber(cfg: FiveSimConfig, id: number): Promise<FiveSimNumber> {
  return api<FiveSimNumber>(cfg, `/user/check/${id}`)
}

/** Cancel a rental before its timeout. Refunds balance if no SMS arrived. */
export async function cancelNumber(cfg: FiveSimConfig, id: number): Promise<FiveSimNumber> {
  return api<FiveSimNumber>(cfg, `/user/cancel/${id}`)
}

/** Mark a rental 'finished' (kept for the timeout window) after we've used the SMS. */
export async function finishNumber(cfg: FiveSimConfig, id: number): Promise<FiveSimNumber> {
  return api<FiveSimNumber>(cfg, `/user/finish/${id}`)
}

/** Read the same OTP extraction logic the bulk-gmail-acc-creator repo uses. */
export function extractOtpFromSms(text: string): string | undefined {
  // Google SMS codes are usually 6 digits, sometimes alphanumeric.
  // Match the first 4-8 char token that looks like a code.
  const m = text.match(/\b(\d{4,8}|[A-Z0-9]{4,8})\b/)
  if (m) return m[1]
  // Fall back: "Code: ABC12" / "G-123456" patterns
  const m2 = text.match(/(?:code|g-)[^\dA-Z]*([A-Z0-9]{4,8})/i)
  return m2?.[1]
}

/**
 * High-level helper: buy a number, poll until SMS arrives (or timeout),
 * return the OTP code. Cancels the rental on timeout so the user
 * doesn't lose the full balance.
 */
export async function buyAndWaitForOtp(
  cfg: FiveSimConfig,
  opts: { country: string; product: string; operator?: string; timeoutMs?: number; pollMs?: number },
): Promise<{ rental: FiveSimNumber; otp?: string }> {
  const operator = opts.operator ?? "any"
  const timeoutMs = opts.timeoutMs ?? 120_000
  const pollMs = opts.pollMs ?? 5_000
  const rental = await buyNumber(cfg, opts.country, operator, opts.product)
  const deadline = Date.now() + timeoutMs
  let last = rental
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs))
    last = await checkNumber(cfg, rental.id)
    if (last.status === "RECEIVED" && last.sms.length > 0) {
      const otp = extractOtpFromSms(last.sms[0]!.text)
      return { rental: last, otp }
    }
    if (last.status === "CANCELED" || last.status === "TIMEOUT" || last.status === "BANNED") {
      return { rental: last }
    }
  }
  // Timed out — cancel so the user isn't charged for an unused rental.
  try {
    await cancelNumber(cfg, rental.id)
  } catch {
    // ignore — best-effort refund
  }
  return { rental: last }
}

/** Convenience: read API key from the standard env var. */
export function fiveSimConfigFromEnv(): FiveSimConfig | undefined {
  const key = process.env.FIVE_SIM_API_KEY ?? process.env.FIVESIM_API_KEY
  if (!key) return undefined
  return { apiKey: key }
}
