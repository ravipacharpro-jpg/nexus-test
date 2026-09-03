// Upgrade 2: Anti-detection stealth
// - Random user-agents per session
// - Human-like typing delays
// - Mouse-movement patterns
// - Timezone / locale rotation
// - Browser fingerprint randomization

import crypto from "crypto"

// Pool of realistic desktop + mobile user agents
const USER_AGENTS = [
  // Chrome / Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
  // Chrome / macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  // Chrome / Linux
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  // Firefox
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
  // Edge
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  // Safari
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
]

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Toronto",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Pacific/Auckland",
]

const LOCALES = [
  "en-US",
  "en-GB",
  "en-CA",
  "en-AU",
  "fr-FR",
  "de-DE",
  "es-ES",
  "it-IT",
  "pt-BR",
  "ja-JP",
  "zh-CN",
]

export interface StealthProfile {
  userAgent: string
  timezone: string
  locale: string
  viewport: { width: number; height: number }
  colorDepth: number
  hardwareConcurrency: number
  deviceMemory: number
  /** 0..1, 1 = maximum stealth (slower typing) */
  speedFactor: number
}

function pick<T>(arr: T[]): T {
  return arr[crypto.randomInt(arr.length)]
}

function randInt(min: number, max: number): number {
  return crypto.randomInt(min, max + 1)
}

/** Returns a randomized stealth profile (one per session). */
export function newStealthProfile(): StealthProfile {
  // Common viewport sizes — mostly laptop + occasional mobile
  const viewports = [
    { width: 1920, height: 1080 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
    { width: 1680, height: 1050 },
  ]
  return {
    userAgent: pick(USER_AGENTS),
    timezone: pick(TIMEZONES),
    locale: pick(LOCALES),
    viewport: pick(viewports),
    colorDepth: pick([24, 30, 48] as const),
    hardwareConcurrency: pick([4, 8, 12, 16] as const),
    deviceMemory: pick([4, 8, 16, 32] as const),
    speedFactor: 0.6 + Math.random() * 0.4, // 0.6..1.0
  }
}

/**
 * Returns a per-keystroke delay (ms) that looks human.
 * Models the natural rhythm of typing: short bursts with
 * occasional longer pauses, plus a variable per-profile
 * speed factor so two "users" don't type identically.
 */
export function humanTypingDelay(profile: StealthProfile): number {
  const base = 60 + Math.random() * 140 // 60–200ms
  const slow = base * profile.speedFactor
  // Occasional long pause (5% chance) — like a person thinking
  if (Math.random() < 0.05) return slow * 3
  return slow
}

/** Delay before a click (ms) — humans look at the button first. */
export function humanClickDelay(): number {
  return 200 + Math.random() * 600
}

/** Delay between page navigation and the next action (ms). */
export function humanReadDelay(): number {
  return 800 + Math.random() * 2200
}

/** Apply a stealth profile to a Playwright-style page (browser MCP). */
export function stealthInitScript(profile: StealthProfile): string {
  return `
    Object.defineProperty(navigator, 'userAgent', { get: () => ${JSON.stringify(profile.userAgent)} });
    Object.defineProperty(navigator, 'language', { get: () => ${JSON.stringify(profile.locale)} });
    Object.defineProperty(navigator, 'languages', { get: () => [${JSON.stringify(profile.locale)}, 'en'] });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${profile.hardwareConcurrency} });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => ${profile.deviceMemory} });
    Object.defineProperty(screen, 'width', { get: () => ${profile.viewport.width} });
    Object.defineProperty(screen, 'height', { get: () => ${profile.viewport.height} });
    Object.defineProperty(screen, 'colorDepth', { get: () => ${profile.colorDepth} });
    const tz = ${JSON.stringify(profile.timezone)};
    Intl.DateTimeFormat.prototype.resolvedOptions = () => ({ locale: ${JSON.stringify(profile.locale)}, calendar: 'gregory', numberingSystem: 'latn', timeZone: tz });
    const _getTimezoneOffset = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = function () {
      const now = new Date();
      const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
      const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
      return Math.round((utc - local) / 60000);
    };
  `
}

/** Returns a CSS-like selector for common Google signup form fields. */
export const FORM_SELECTORS = {
  firstName: 'input[name="firstName"]',
  lastName: 'input[name="lastName"]',
  username: 'input[name="Username"], input[name="username"]',
  password: 'input[name="Passwd"], input[name="password"]',
  passwordConfirm: 'input[name="PasswdAgain"], input[name="confirmPassword"]',
  nextButton: 'button:has-text("Next"), button[type="submit"]',
  phoneInput: 'input[type="tel"], input[name="phoneNumber"]',
  recoveryEmail: 'input[name="recoveryEmail"]',
  monthSelect: 'select[name="month"]',
  daySelect: 'select[name="day"]',
  yearSelect: 'select[name="year"]',
  genderSelect: 'select[name="gender"]',
}

/** Sleep that doesn't get optimized away by V8. */
export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

/** Type text into a field with human-like delays. */
export async function typeHumanLike(
  typeFn: (text: string) => Promise<void>,
  text: string,
  profile: StealthProfile,
): Promise<void> {
  // type by chunks of 1-3 chars to mimic burst typing
  let i = 0
  while (i < text.length) {
    const chunk = text.slice(i, i + 1 + crypto.randomInt(2))
    await typeFn(chunk)
    i += chunk.length
    await sleep(humanTypingDelay(profile))
  }
}
