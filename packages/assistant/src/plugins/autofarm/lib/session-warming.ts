// session-warming: drive the browser through 3-5 random human-looking
// sites before the real signup target so Google sees a session that
// looks like a person, not a bot. Inspired by the bulk-gmail-acc-creator
// repo's "session warming" pattern.
//
// Cross-platform: uses only the existing browser abstraction; no
// native deps, no shell out. Works on Termux, Linux, macOS, Windows
// as long as the user has launched the Playwright MCP server once.
//
// Why it helps: Google's bot detector scores a fresh session with zero
// prior history as high-risk. After warming, cookies + localStorage
// + history all look real and the account-creation flow has a much
// higher chance of reaching the verification step without an
// interstitial "verify you're human" challenge.

import { browser } from "./browser.ts"
import { log } from "./logger.ts"

const WARMING_SITES: ReadonlyArray<{ url: string; kind: "news" | "wiki" | "social" | "video" | "shopping" }> = [
  { url: "https://www.bbc.com/news", kind: "news" },
  { url: "https://en.wikipedia.org/wiki/Main_Page", kind: "wiki" },
  { url: "https://www.youtube.com/feed/trending", kind: "video" },
  { url: "https://www.reddit.com/", kind: "social" },
  { url: "https://www.amazon.com/", kind: "shopping" },
  { url: "https://www.nytimes.com/", kind: "news" },
  { url: "https://en.wikipedia.org/wiki/Special:Random", kind: "wiki" },
  { url: "https://www.twitch.tv/", kind: "video" },
  { url: "https://twitter.com/explore", kind: "social" },
  { url: "https://www.ebay.com/", kind: "shopping" },
]

/** Pick 3-5 random sites, never the same one twice in a row. */
function pickSites(n: number): typeof WARMING_SITES {
  const pool = [...WARMING_SITES]
  const out: typeof WARMING_SITES = []
  while (out.length < n && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length)
    const site = pool.splice(idx, 1)[0]
    // Avoid the same kind twice in a row (a real user doesn't read two
    // BBC pages back to back without a wiki detour).
    if (out.length > 0 && out[out.length - 1]!.kind === site.kind) continue
    out.push(site)
  }
  return out
}

function randomDelayMs(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min))
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Drive the browser through 3-5 random sites. Safe to call multiple
 * times — each call is independent. If the browser is not available
 * (Termux without a launched MCP server) this is a no-op.
 *
 * @param opts.sites  How many sites to visit (default 4, max 8).
 * @param opts.minDwellMs / maxDwellMs  Per-site wait window.
 */
export async function warmup(opts: { sites?: number; minDwellMs?: number; maxDwellMs?: number } = {}): Promise<{
  visited: number
  totalMs: number
  skipped: boolean
}> {
  const t0 = Date.now()
  const sites = pickSites(Math.max(1, Math.min(8, opts.sites ?? 4)))
  const minDwell = opts.minDwellMs ?? 3_000
  const maxDwell = opts.maxDwellMs ?? 8_000

  // Quick availability check without forcing an init.
  let available = false
  try {
    available = typeof browser?.navigate === "function"
  } catch {
    available = false
  }
  if (!available) {
    log.warn("warming", "browser.navigate not available; session warming skipped")
    return { visited: 0, totalMs: 0, skipped: true }
  }

  for (const site of sites) {
    try {
      await browser.navigate(site.url)
      const dwell = randomDelayMs(minDwell, maxDwell)
      // Scroll a tiny bit to mimic reading.
      try {
        await browser.evaluate("window.scrollTo({ top: 200, behavior: 'instant' })")
      } catch {
        // ignore scroll failures — some sites block eval
      }
      log.info("warming", `visited ${site.url} (${site.kind}, ${dwell}ms)`)
      await sleep(dwell)
    } catch (e) {
      log.warn("warming", `failed to visit ${site.url}: ${(e as Error).message}`)
    }
  }
  return { visited: sites.length, totalMs: Date.now() - t0, skipped: false }
}
