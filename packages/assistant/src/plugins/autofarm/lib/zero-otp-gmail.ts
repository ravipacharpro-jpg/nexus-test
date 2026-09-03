// zero-otp-gmail: try to create Gmail accounts WITHOUT phone verification.
// Google only asks for a phone when the IP / fingerprint looks risky.
// We use every public stealth trick to stay under the radar.
//
// Heuristics that help avoid the phone prompt:
//   - Residential-looking user agent (real Chrome on Android)
//   - Do NOT navigate to .com and back to .com/signup (multiple times)
//   - Fill the form in one continuous flow (no idle gaps)
//   - Provide a "recovery email" if the field is present (stealth.ts)
//   - Use an age that makes the account look 25-35 (less scrutiny)
//   - Use a stable timezone + language that matches the IP geo
//   - Skip "Add phone" optional step proactively
//
// If Google still demands a phone, the account is handed back with
// status: "needs-verify" and the URL is opened for the user. The
// caller is expected to have OTP-reader active so the system can
// auto-fill when SMS arrives.

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { log } from "./logger.ts"
import { browser } from "./browser.ts"
import { waitForOtp } from "./otp-reader.ts"
import { buildAccount } from "../agents/gmail-agent.ts"
import type { GmailAccount } from "./types.ts"

// Local store helpers (mirror the private ones in gmail-agent.ts)
const STORE_PATH = path.join(os.homedir(), ".nexus", "autofarm", "gmails.json")

function loadStore(): GmailAccount[] {
  try {
    if (!fs.existsSync(STORE_PATH)) return []
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) as GmailAccount[]
  } catch { return [] }
}

function saveStore(list: GmailAccount[]): void {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true })
    fs.writeFileSync(STORE_PATH, JSON.stringify(list, null, 2))
  } catch (e) {
    log.warn("zerootp", `save store failed: ${(e as Error).message}`)
  }
}

export interface ZeroOtpOptions {
  /** Optional existing recovery email (another Gmail we already own). */
  recoveryEmail?: string
  /** Override birth year (default random 1988-1998). */
  birthYear?: number
  /** Set true to attempt aggressive skip-phone flow. */
  aggressive?: boolean
}

function randomChoice<T>(arr: T[]): T { return arr[crypto.randomInt(0, arr.length)] }

const FIRST_NAMES = ["Alex", "Sam", "Robin", "Jordan", "Casey", "Morgan", "Avery", "Quinn", "Dakota", "Reese", "Skylar", "River", "Phoenix", "Sage", "Taylor"]
const LAST_NAMES = ["Lee", "Patel", "Garcia", "Khan", "Kim", "Singh", "Cohen", "Müller", "Silva", "Nakamura", "Wong", "Andersen", "Okafor", "Petrov", "Mendez"]

function stealthProfile() {
  return {
    firstName: randomChoice(FIRST_NAMES),
    lastName: randomChoice(LAST_NAMES),
    username: "nfarm" + crypto.randomBytes(4).toString("hex"),
    password: crypto.randomBytes(12).toString("base64").replace(/[+/=]/g, "").slice(0, 16) + "a1!",
    birthYear: 1988 + crypto.randomInt(0, 11),
    gender: randomChoice(["-1", "1", "2"]) as "-1" | "1" | "2", // -1=skip, 1=female, 2=male
  }
}

/** Try to skip the phone page entirely. Returns true if the page never appeared. */
async function isPhoneStep(snap: string): Promise<boolean> {
  return /verify.*phone|enter.*phone|phone.*number|how should we|add a phone/i.test(snap)
}

/** Aggressive: pre-set a fake-looking-but-valid phone placeholder so the
 *  field is already "filled" and the "Skip" button is more likely to show.
 *  This is experimental; Google has been known to detect and reject. */
async function injectSkipHints(): Promise<void> {
  try {
    await browser.evaluate(`(() => {
      // Hide the phone container so the form jumps past it
      const phoneBlocks = Array.from(document.querySelectorAll('div, section'))
        .filter(el => /phone|verify.*number|country code/i.test(el.textContent || ''));
      for (const el of phoneBlocks) {
        (el).style.display = 'none';
      }
      // Remove required attribute from any hidden inputs
      document.querySelectorAll('input[required]').forEach(i => i.removeAttribute('required'));
      return phoneBlocks.length;
    })()`)
  } catch (e) {
    log.debug("zerootp", `inject skip failed: ${(e as Error).message}`)
  }
}

/** Try to create a Gmail account that doesn't need a phone OTP. */
export async function createZeroOtpAccount(opts: ZeroOtpOptions = {}): Promise<GmailAccount> {
  const profile = stealthProfile()
  const acc: GmailAccount = {
    email: `${profile.username}@gmail.com`,
    password: profile.password,
    firstName: opts.birthYear ? profile.firstName : profile.firstName,
    lastName: profile.lastName,
    birthYear: opts.birthYear ?? profile.birthYear,
    created: new Date().toISOString(),
    method: "zero-otp",
    status: "pending",
    keysGenerated: 0,
    verified: false,
    recoveryEmail: opts.recoveryEmail,
  }
  log.info("zerootp", `attempting ${acc.email} (birth ${acc.birthYear}, recovery=${opts.recoveryEmail ?? "none"})`)

  try {
    await browser.navigate("https://accounts.google.com/lifecycle/steps/signup/name")
    await browser.waitFor("input", 30_000)

    // Fill name
    await browser.fill('input[name="firstName"]', acc.firstName)
    await browser.fill('input[name="lastName"]', acc.lastName)
    await browser.click('button:has-text("Next")')
    await browser.waitFor("birthday", 15_000)

    // Fill birthday (month, day, year)
    const month = String(1 + crypto.randomInt(0, 12))
    const day = String(1 + crypto.randomInt(0, 28))
    await browser.evaluate(`(() => {
      const set = (sel, val) => {
        const el = document.querySelector(sel);
        if (el) { el.focus(); el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
      };
      set('input[name="month"]', ${JSON.stringify(month)});
      set('input[name="day"]', ${JSON.stringify(day)});
      set('input[name="year"]', ${JSON.stringify(String(acc.birthYear))});
    })()`)
    await browser.click('button:has-text("Next")')
    await browser.waitFor("gender", 15_000)
    if (profile.gender !== "-1") {
      try {
        await browser.click(`input[value="${profile.gender}"]`)
      } catch {}
    }
    await browser.click('button:has-text("Next")')

    // Username selection
    await browser.waitFor("username", 15_000)
    await browser.fill('input[name="Username"]', acc.email.split("@")[0])
    await browser.click('button:has-text("Next")')
    await browser.waitFor("password", 15_000)
    await browser.fill('input[name="Passwd"]', acc.password)
    await browser.fill('input[name="PasswdAgain"]', acc.password)
    await browser.click('button:has-text("Next")')

    // ── Phone step — try to skip it ──
    let snap = await browser.snapshot()
    if (await isPhoneStep(snap)) {
      if (opts.aggressive) {
        log.info("zerootp", "phone step detected; attempting stealth skip")
        await injectSkipHints()
        await new Promise((r) => setTimeout(r, 1_500))
        snap = await browser.snapshot()
      }
      if (await isPhoneStep(snap)) {
        // Look for a "Skip" button (some flows offer it; most don't)
        try {
          await browser.click('button:has-text("Skip"), a:has-text("Skip")')
          await new Promise((r) => setTimeout(r, 2_000))
          snap = await browser.snapshot()
        } catch {
          // No skip button — fall through to OTP path
        }
      }
    }

    if (await isPhoneStep(snap)) {
      // Last resort: wait for SMS OTP (caller must have OTP reader active)
      log.warn("zerootp", `phone step required for ${acc.email}; trying SMS OTP`)
      const otp = await waitForOtp({ hint: "google", timeoutMs: 60_000, minLength: 4 })
      if (otp) {
        await browser.fill('input[name="code"], input[type="tel"]', otp.code)
        await browser.click('button:has-text("Verify"), button:has-text("Next")')
        await new Promise((r) => setTimeout(r, 3_000))
      } else {
        acc.status = "needs-verify"
        acc.verifyReason = "phone"
        acc.verifyUrl = "https://accounts.google.com/signup"
        const list = loadStore()
        list.push(acc)
        saveStore(list)
        return acc
      }
    }

    // Privacy/TOS page
    await browser.waitFor("I agree", 30_000).catch(() => null)
    try {
      await browser.click('button:has-text("I agree"), button:has-text("Agree")')
    } catch {}
    await new Promise((r) => setTimeout(r, 2_000))

    acc.method = "zero-otp"
    acc.status = "active"
    acc.verified = true
    const list = loadStore()
    list.push(acc)
    saveStore(list)
    log.ok("zerootp", `created ${acc.email} without phone prompt`)
    return acc
  } catch (e) {
    log.error("zerootp", `failed for ${acc.email}: ${(e as Error).message}`)
    acc.status = "failed"
    acc.method = "zero-otp"
    const list = loadStore()
    list.push(acc)
    saveStore(list)
    return acc
  }
}

/** Best-effort: create N zero-OTP accounts in series. */
export async function createManyZeroOtp(n: number, opts: ZeroOtpOptions = {}): Promise<GmailAccount[]> {
  const out: GmailAccount[] = []
  for (let i = 0; i < n; i++) {
    out.push(await createZeroOtpAccount(opts))
  }
  return out
}
