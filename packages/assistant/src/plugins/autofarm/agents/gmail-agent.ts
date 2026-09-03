// Gmail agent: creates random anonymous Gmail accounts.
// Privacy: we never add any personal data — first/last names come from
// a fixed pool of neutral aliases and the year of birth is randomized
// within a fixed range so Google never asks for "real" personal info.

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
import { log } from "../lib/logger.ts"
import { browser } from "../lib/browser.ts"
import { waitForOtp } from "../lib/otp-reader.ts"
import { warmup } from "../lib/session-warming.ts"
import { pickNumber as quackrPickNumber, waitForFreeOtp as quackrWait } from "../lib/quackr.ts"
import type { GmailAccount } from "../lib/types.ts"

const STORE_PATH = path.join(os.homedir(), ".nexus", "autofarm", "gmails.json")

const FIRST_NAMES = [
  "Zephyr", "Orion", "Cassius", "Lyra", "Kael", "Sable", "Nova", "Zyx", "Riven", "Astrid",
  "Felix", "Neo", "Jax", "Echo", "Mira", "Dax", "Koda", "Luna", "Ryker", "Zara",
  "Ash", "Blaze", "Crimson", "Drift", "Ember", "Frost", "Ghost", "Haze", "Ivy", "Jinx",
  "Kite", "Leaf", "Mist", "Neon", "Onyx", "Pulse", "Quill", "Rune", "Spark", "Twilight",
  "Ultra", "Vex", "Wren", "Xeno", "Yield", "Zinc", "Aero", "Bolt", "Crest", "Dusk",
]

const LAST_NAMES = [
  "Voss", "Drake", "Knight", "Storm", "Blaze", "Frost", "Hawk", "Irons", "Jade", "Kite",
  "Lumen", "Mark", "Nite", "Onyx", "Pike", "Quinn", "Rune", "Sable", "Tide", "Ulric",
  "Vex", "Wolf", "Xen", "Yarn", "Zephyr", "Acer", "Bane", "Cove", "Dusk", "Elms",
  "Finn", "Grove", "Hull", "Ivy", "Jolt", "Kelp", "Lorn", "Moss", "Neve", "Oak",
  "Pine", "Reed", "Shale", "Torn", "Urb", "Vale", "Wren", "Xyl", "Yew", "Zinc",
]

function randomChoice<T>(arr: T[]): T {
  return arr[crypto.randomInt(0, arr.length)]
}

function randomPassword(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*"
  let out = ""
  for (let i = 0; i < 16; i++) out += chars[crypto.randomInt(0, chars.length)]
  return out
}

function randomUsername(): string {
  return "nfarm" + crypto.randomBytes(4).toString("hex")
}

function loadStore(): GmailAccount[] {
  try {
    if (!fs.existsSync(STORE_PATH)) return []
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) as GmailAccount[]
  } catch {
    return []
  }
}

function saveStore(accounts: GmailAccount[]): void {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true })
    fs.writeFileSync(STORE_PATH, JSON.stringify(accounts, null, 2))
  } catch (e) {
    log.error("gmail", `Failed to save store: ${(e as Error).message}`)
  }
}

export function listAccounts(): GmailAccount[] {
  return loadStore()
}

export function pendingVerify(): GmailAccount[] {
  return loadStore().filter((a) => a.status === "needs-verify" && !!a.verifyUrl)
}

export function markVerified(email: string, ok: boolean): void {
  const list = loadStore()
  const found = list.find((a) => a.email === email)
  if (!found) return
  found.status = ok ? "active" : "failed"
  found.verified = ok
  found.verifyUrl = undefined
  saveStore(list)
}

export function buildAccount(): GmailAccount {
  const first = randomChoice(FIRST_NAMES)
  const last = randomChoice(LAST_NAMES)
  const username = randomUsername()
  // Year of birth: random within a 30-year window, all adults.
  const year = 1970 + crypto.randomInt(0, 35)
  return {
    email: `${username}@gmail.com`,
    password: randomPassword(),
    firstName: first,
    lastName: last,
    birthYear: year,
    created: new Date().toISOString(),
    method: "pending",
    status: "pending",
    keysGenerated: 0,
    verified: false,
  }
}

/**
 * Drive a Google signup via Playwright.
 * If we hit a CAPTCHA / phone verification we surface the URL back to the
 * orchestrator so it can open it for the user.
 */
export async function createAccountViaBrowser(): Promise<GmailAccount> {
  const acc = buildAccount()
  log.info("gmail", `Creating ${acc.email} via browser automation`)

  try {
    // Session warming: visit 3-5 random sites first so Google sees
    // a real-user fingerprint (cookies, history, localStorage) instead
    // of a fresh browser that hits the signup page cold. Inspired by
    // the bulk-gmail-acc-creator repo's "session warming" pattern.
    // Safe no-op when the browser is not available.
    await warmup()

    await browser.navigate("https://accounts.google.com/signup")

    // The Google signup page has several forms. We try to fill them
    // heuristically — when the snapshot changes we adapt.
    await browser.waitFor("Create your Google Account", 30_000)

    // Use evaluate to find common selectors quickly.
    await browser.evaluate(`(() => {
      const inputs = document.querySelectorAll('input');
      const set = (name, value) => {
        for (const el of inputs) {
          if (el.name && el.name.toLowerCase().includes(name)) { el.focus(); }
        }
      };
      set('first', '');
      set('last', '');
      return inputs.length;
    })()`)

    await browser.fill('input[name="firstName"]', acc.firstName)
    await browser.fill('input[name="lastName"]', acc.lastName)
    await browser.click('button:has-text("Next")')
    await browser.waitFor("username", 15_000)
    await browser.fill('input[name="Username"]', acc.email.split("@")[0])
    await browser.click('button:has-text("Next")')
    await browser.waitFor("password", 15_000)
    await browser.fill('input[name="Passwd"]', acc.password)
    await browser.fill('input[name="PasswdAgain"]', acc.password)
    await browser.click('button:has-text("Next")')

    // At this point Google may show a CAPTCHA or phone prompt.
    const snap = await browser.snapshot()
    if (/verify.*phone|enter.*phone|phone.*number/i.test(snap) ||
        /captcha|verify.*you.*are.*human/i.test(snap)) {
      const url = "https://accounts.google.com/signup"
      acc.method = "browser"
      acc.status = "needs-verify"
      acc.verifyReason = /phone/i.test(snap) ? "phone" : "captcha"
      acc.verifyUrl = url
      const list = loadStore()
      list.push(acc)
      saveStore(list)
      log.warn("gmail", `Verification required for ${acc.email} — handing off to user`)

      // ── Autonomy: try to auto-fill phone OTP via Quackr (free public
      // SMS receive), then fall back to the local Termux SMS reader. The
      // user never has to type their personal phone number.
      if (acc.verifyReason === "phone") {
        log.info("gmail", `picking a free Quackr number for ${acc.email}…`)
        const freeNumber = await quackrPickNumber().catch(() => undefined)
        if (freeNumber) {
          log.info("gmail", `using Quackr number ${freeNumber.phone} (${freeNumber.country})`)
          // Try to type the number into the phone field on the page.
          try {
            await browser.evaluate(`(async (phone) => {
              const sel = 'input[type="tel"], input[name="phoneNumber"], input[id*="phone"]';
              const el = document.querySelector(sel);
              if (!el) return false;
              el.focus();
              el.value = phone;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            })(${JSON.stringify(freeNumber.phone)})`)
            await browser.click('button:has-text("Next"), button[type="submit"]')
            await new Promise((r) => setTimeout(r, 3_000))
          } catch (e) {
            log.warn("gmail", `phone number entry skipped: ${(e as Error).message}`)
          }
        } else {
          log.warn("gmail", `no Quackr number available, falling back to Termux SMS reader`)
        }
        log.info("gmail", `waiting up to 90s for SMS OTP for ${acc.email}…`)
        // First try Quackr (no auth) — if the user entered the Quackr
        // number above, the SMS will land in the public inbox.
        const quackrResult = await quackrWait({ timeoutMs: 90_000, pollMs: 6_000 }).catch(() => undefined)
        const otp = quackrResult?.otp
          ? { code: quackrResult.otp, source: "quackr" as const }
          : await waitForOtp({ hint: "google", timeoutMs: 30_000, minLength: 4 })
        if (otp) {
          try {
            // Find the OTP input on the page and fill it.
            const filled = await browser.evaluate(`(async (code) => {
              const sel = 'input[name="code"], input[type="tel"], input[autocomplete="one-time-code"], input[name="otp"]';
              const el = document.querySelector(sel);
              if (!el) return false;
              el.focus();
              el.value = code;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            })(${JSON.stringify(otp.code)})`) as unknown
            if (filled) {
              // Try common submit button selectors
              await browser.click('button:has-text("Verify"), button:has-text("Next"), button[type="submit"]')
              await new Promise((r) => setTimeout(r, 2_000))
              acc.status = "active"
              acc.verified = true
              acc.verifyUrl = undefined
              const list2 = loadStore()
              const idx2 = list2.findIndex((a) => a.email === acc.email)
              if (idx2 >= 0) {
                list2[idx2] = acc
                saveStore(list2)
              }
              log.ok("gmail", `Auto-filled SMS OTP and verified ${acc.email}`)
              return acc
            }
          } catch (e) {
            log.warn("gmail", `OTP auto-fill failed: ${(e as Error).message}`)
          }
        } else {
          log.warn("gmail", `no SMS OTP received in 90s; user must complete verification`)
        }
      }
      return acc
    }

    // No challenge — assume success.
    acc.method = "browser"
    acc.status = "active"
    acc.verified = true
    const list = loadStore()
    list.push(acc)
    saveStore(list)
    log.ok("gmail", `Created ${acc.email} automatically`)
    return acc
  } catch (e) {
    log.error("gmail", `Browser automation failed for ${acc.email}: ${(e as Error).message}`)
    acc.status = "failed"
    acc.method = "browser"
    const list = loadStore()
    list.push(acc)
    saveStore(list)
    return acc
  }
}

/**
 * Hand a Gmail creation off to the human when browser automation cannot
 * proceed. Returns the account object with the URL the user needs to open.
 */
export function handOffForUser(): GmailAccount {
  const acc = buildAccount()
  acc.method = "manual"
  acc.status = "needs-verify"
  acc.verifyReason = "captcha"
  acc.verifyUrl = "https://accounts.google.com/signup"
  const list = loadStore()
  list.push(acc)
  saveStore(list)
  log.warn("gmail", `Hand-off: user must create ${acc.email} manually`)
  return acc
}

export async function createMany(n: number): Promise<GmailAccount[]> {
  const out: GmailAccount[] = []
  for (let i = 0; i < n; i++) {
    const a = await createAccountViaBrowser()
    out.push(a)
    if (a.status === "needs-verify") {
      // Stop spawning more; let the user clear the verify queue first.
      break
    }
  }
  return out
}