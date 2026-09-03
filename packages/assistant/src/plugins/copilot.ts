import os from "os"
import path from "path"
import { Style, Icon, dim } from "../core/style"
import { requireAuthorizedTarget } from "../core/security"
import type { NexusPlugin, PluginContext } from "../core/types"

const LOGIN_INDICATORS = ["login", "signin", "sign-in", "auth", "cpsess", "wp-login"]

const DASHBOARD_SELECTORS = [
  "#cpanelBody",
  "#home-icon",
  ".dashboard",
  "[data-testid='dashboard']",
  ".user-menu",
  "a[href*='logout']",
  "button:has-text('Logout')",
  ".wp-admin-bar",
  "#adminmenu",
  ".gh-nav",
]

const DEDICATED_PROFILE = path.join(os.homedir(), ".nexus", "browser-profile")
export const COPILOT_LAUNCH_ARGS = ["--no-first-run", "--no-default-browser-check"]

async function isLoggedIn(page: import("playwright-core").Page): Promise<boolean> {
  const currentUrl = page.url().toLowerCase()
  if (LOGIN_INDICATORS.some((i) => currentUrl.includes(i))) return false
  for (const selector of DASHBOARD_SELECTORS) {
    const visible = await page.locator(selector).first().isVisible().catch(() => false)
    if (visible) return true
  }
  return false
}

async function waitForLogin(page: import("playwright-core").Page, ctx: PluginContext): Promise<boolean> {
  ctx.out(`${Icon.lock} Login needed — browser is open for you`)
  ctx.out(dim("NEXUS NEVER fills passwords or reads OTPs. You type them; NEXUS waits smartly."))
  ctx.out(dim("Auto-detecting login... (or press ENTER here the moment you finish)"))

  const deadline = Date.now() + 5 * 60 * 1000
  let enterPressed = false
  const stdinListener = (): void => {
    enterPressed = true
  }
  process.stdin.resume()
  process.stdin.once("data", stdinListener)

  try {
    while (Date.now() < deadline) {
      if (enterPressed) return true
      const page_ = page
      const loggedIn = await isLoggedIn(page_).catch(() => false)
      if (loggedIn) {
        ctx.out(`${Icon.success} Login detected — resuming automatically!`)
        return true
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
    ctx.out(dim("Login was not confirmed within 5 minutes — session closed without continuing."))
    return false
  } finally {
    process.stdin.removeListener("data", stdinListener)
    process.stdin.pause()
  }
}

async function doTask(ctx: PluginContext): Promise<number | void> {
  let url = typeof ctx.flags.url === "string" ? ctx.flags.url : undefined
  const task = ctx.args.join(" ") || (typeof ctx.flags.task === "string" ? ctx.flags.task : "")

  if (!url && ctx.args[0]?.startsWith("http")) url = ctx.args[0]
  if (!url) {
    ctx.err('Usage: nexus copilot do --url https://host:2083 "database banao"')
    return 1
  }
  if (!(await requireAuthorizedTarget(ctx, url, "browser co-pilot"))) return 1

  const pw = await import("playwright-core")
    .then(() => ({ ok: true as const }))
    .catch(() => ({ ok: false as const, reason: "playwright-core not installed" }))
  if (!pw.ok) {
    ctx.err(`Co-Pilot unavailable: ${pw.reason}`)
    ctx.out(dim("Browser automation needs a desktop environment + chromium. On Termux use cpanel/deploy plugins instead."))
    return 1
  }

  const { chromium } = await import("playwright-core")
  const browserName = typeof ctx.flags.browser === "string" ? ctx.flags.browser : "chrome"

  let context: import("playwright-core").BrowserContext
  let page: import("playwright-core").Page

  if (ctx.flags.connectExisting === true) {
    const port = typeof ctx.flags.port === "number" ? ctx.flags.port : 9222
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      ctx.err("A valid local CDP port is required (1024-65535).")
      return 1
    }
    try {
      const browser = await chromium.connectOverCDP(`http://localhost:${port}`)
      context = browser.contexts()[0] ?? (await browser.newContext())
      page = context.pages()[0] ?? (await context.newPage())
      ctx.out(`${Icon.success} Attached to running browser on port ${port}`)
    } catch {
      ctx.err(`No browser on port ${port}. Start Chrome with: --remote-debugging-port=${port}`)
      return 1
    }
  } else {
    const profileDir = ctx.flags.newProfile === true ? path.join(os.tmpdir(), "nexus-copilot-profile") : DEDICATED_PROFILE
    ctx.out(
      dim(
        ctx.flags.newProfile === true
          ? "Temporary NEXUS profile — logins will not be remembered."
          : "Using dedicated NEXUS profile (~/.nexus/browser-profile); your normal browser profile is never opened.",
      ),
    )

    await import("fs/promises").then((fs) => fs.mkdir(profileDir, { recursive: true }))
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      channel: browserName === "chrome" ? "chrome" : "msedge",
      args: COPILOT_LAUNCH_ARGS,
    })
    page = context.pages()[0] ?? (await context.newPage())
  }

  ctx.out(`${Icon.robot} Navigating to ${url}`)

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 })
  } catch (error) {
    ctx.err(`Navigation failed: ${error instanceof Error ? error.message : error}`)
    if (ctx.flags.connectExisting !== true) await context.close()
    return 1
  }

  if (await isLoggedIn(page).catch(() => false)) {
    ctx.out(`${Icon.success} Session active — NO login needed!`)
  } else {
    const loggedIn = await waitForLogin(page, ctx)
    if (!loggedIn) {
      if (ctx.flags.connectExisting !== true) await context.close()
      return 1
    }
    ctx.out(dim("Session saved in profile — next time login skip ho jayega."))
  }

  if (task) {
    ctx.out(`${Icon.brain} Task: ${task}`)
    ctx.out(dim("Destructive actions still ask for confirmation."))
  }

  ctx.out(`${Icon.info} Browser open for co-piloting. Press ENTER here to finish.`)
  await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()))

  if (ctx.flags.connectExisting !== true) await context.close()
}

const plugin: NexusPlugin = {
  name: "copilot",
  version: "0.1.0",
  description: "Browser co-pilot with session reuse and hard human-in-the-loop gates",
  tags: ["browser", "automation", "hitl"],
  requires: {
    platform: ["linux", "darwin", "win32"],
    check: () => ({ ok: true }),
  },
  commands: [
    {
      name: "do",
      describe: 'open a browser task — login once, remembered forever. e.g. nexus copilot do --url https://myhost.com:2083 "database banao"',
      usage: 'nexus copilot do [--url URL] [--browser chrome|edge] [--new-profile] [--connect-existing --port 9222] "<task>"',
      run: doTask,
    },
  ],
}

export default plugin

export * as CopilotPlugin from "./copilot"
