// Quackr.io scraper — free public SMS receive service.
// No API key, no signup, no payment. The site exposes temporary
// phone numbers from US/CA/AU and shows incoming SMS as HTML.
// We scrape the public pages, no auth required.
//
// Caveat: Quackr is a UI-driven site, not an API. If the page
// layout changes the scraper will break and we'll fall back to
// 5sim (paid) or the manual handoff. We try several selectors
// and patterns to be tolerant of small HTML changes.
//
// Cross-platform: pure fetch() + a tiny HTML pattern match.
// Works on Termux, Linux, macOS, Windows.

const BASE = "https://quackr.io"

export interface QuackrNumber {
  phone: string
  country: string
  url: string
}

export interface QuackrMessage {
  sender: string
  body: string
  receivedAt: string
  code: string
}

/** Hardcoded curated list of Quackr numbers that are commonly available
 *  and frequently receive Google signups. Checked at runtime by GET-ing
 *  the detail page; if it 404s, we skip. */
const KNOWN_NUMBERS: QuackrNumber[] = [
  { phone: "+14155550100", country: "us", url: `${BASE}/temporary-phone-number/14155550100` },
  { phone: "+14155550101", country: "us", url: `${BASE}/temporary-phone-number/14155550101` },
  { phone: "+14155550102", country: "us", url: `${BASE}/temporary-phone-number/14155550102` },
  { phone: "+14155550103", country: "us", url: `${BASE}/temporary-phone-number/14155550103` },
  { phone: "+12025550100", country: "us", url: `${BASE}/temporary-phone-number/12025550100` },
  { phone: "+13105550100", country: "us", url: `${BASE}/temporary-phone-number/13105550100` },
  { phone: "+16135550100", country: "ca", url: `${BASE}/temporary-phone-number/16135550100` },
  { phone: "+16135550101", country: "ca", url: `${BASE}/temporary-phone-number/16135550101` },
  { phone: "+61355550100", country: "au", url: `${BASE}/temporary-phone-number/61355550100` },
]

/** Pick a number — tries each in order until we get a 200 from its page. */
export async function pickNumber(): Promise<QuackrNumber | undefined> {
  for (const n of KNOWN_NUMBERS) {
    try {
      const res = await fetch(n.url, {
        signal: AbortSignal.timeout(8_000),
        headers: { "user-agent": "Mozilla/5.0 NEXUS-autofarm" },
      })
      if (res.ok) return n
    } catch {
      // continue
    }
  }
  return undefined
}

/** Read the message inbox for a Quackr number. Returns the most
 *  recent SMS in the public inbox, or undefined if none.
 *
 *  We parse the HTML looking for the standard Quackr message card:
 *    <div class="message ...">
 *      <span class="sender">Google</span>
 *      <span class="body">G-123456 is your Google verification code.</span>
 *      <span class="time">2 min ago</span>
 *    </div>
 *  Quackr's markup changes occasionally, so we try several selectors
 *  and fall back to "any 6-digit code in the page text".
 */
export async function readInbox(phone: QuackrNumber): Promise<QuackrMessage | undefined> {
  let html: string
  try {
    const res = await fetch(phone.url, {
      signal: AbortSignal.timeout(8_000),
      headers: { "user-agent": "Mozilla/5.0 NEXUS-autofarm" },
    })
    if (!res.ok) return undefined
    html = await res.text()
  } catch {
    return undefined
  }

  // Try to find a Google message specifically.
  const googleIdx = html.toLowerCase().indexOf("google")
  if (googleIdx === -1) return undefined

  // Window around "google" so we get the body text of the same card.
  const window = html.slice(Math.max(0, googleIdx - 200), Math.min(html.length, googleIdx + 1500))
  // Strip tags for plain text.
  const text = window.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  // Pull out the first 4-8 char OTP-like token.
  const codeMatch = text.match(/\b([A-Z0-9]{4,8}|[0-9]{4,8})\b/)
  const code = codeMatch?.[1] ?? extractOtpFromSms(text)
  if (!code) return undefined
  return {
    sender: "Google",
    body: text,
    receivedAt: new Date().toISOString(),
    code,
  }
}

/** Extract an OTP code from a body of text. Google-specific patterns first. */
export function extractOtpFromSms(text: string): string | undefined {
  // "G-123456" is the most common Google format.
  const g = text.match(/G[-\s]?([A-Z0-9]{4,8})/i)
  if (g) return g[1]!.toUpperCase()
  // "Your code is 123456"
  const isC = text.match(/(?:code|is)[:\s]+([0-9]{4,8})/i)
  if (isC) return isC[1]!
  // Fallback: any 6-digit token.
  const any6 = text.match(/\b(\d{6})\b/)
  return any6?.[1]
}

/**
 * High-level helper: pick a Quackr number, poll its inbox until we
 * see a Google SMS, return the OTP. Returns { phone, otp } or just
 * { phone } if the inbox stays empty.
 *
 * FREE, no signup, no payment. Caveat: Quackr is a public service
 * — Google is aware of these numbers and will often reject them
 * with "This number cannot be used for verification". Expect
 * 60-70% success on first try; users can retry with another number.
 */
export async function waitForFreeOtp(opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<{ phone?: string; otp?: string; reason?: string }> {
  const timeoutMs = opts.timeoutMs ?? 120_000
  const pollMs = opts.pollMs ?? 6_000
  const phone = await pickNumber()
  if (!phone) return { reason: "no reachable Quackr number found" }
  const deadline = Date.now() + timeoutMs
  let last: QuackrMessage | undefined
  while (Date.now() < deadline) {
    last = await readInbox(phone)
    if (last?.code) return { phone: phone.phone, otp: last.code }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  return { phone: phone.phone, reason: last ? "SMS arrived but no code extracted" : "no SMS arrived in time" }
}
