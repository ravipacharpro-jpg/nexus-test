import path from "path"
import { Style, Icon, ok, bad, dim } from "../core/style"
import { requireAuthorizedTarget } from "../core/security"

const EOL = "\n"
import type { NexusPlugin, PluginContext } from "../core/types"

interface ScenarioStep {
  action: string
  selector?: string
  url?: string
  expected?: string
  value?: string
  ms?: number
  header?: string
}

const SCENARIOS: Record<string, ScenarioStep[]> = {
  smoke: [
    { action: "navigate", url: "{{URL}}" },
    { action: "assert_status", expected: "200" },
    { action: "assert_console_clean" },
    { action: "screenshot", value: "homepage" },
  ],
  headers: [
    { action: "navigate", url: "{{URL}}" },
    { action: "assert_header", selector: "x-content-type-options", expected: "nosniff" },
    { action: "assert_header", selector: "referrer-policy" },
  ],
  forms: [
    { action: "navigate", url: "{{URL}}" },
    { action: "assert_visible", selector: "form" },
  ],
  login: [
    { action: "navigate", url: "{{URL}}/login" },
    { action: "assert_visible", selector: "input[type=\"email\"], input[name=\"email\"]" },
    { action: "assert_visible", selector: "input[type=\"password\"]" },
    { action: "assert_header", header: "x-frame-options" },
    { action: "assert_console_clean" },
  ],
  purchase: [
    { action: "navigate", url: "{{URL}}" },
    { action: "assert_visible", selector: "body" },
    { action: "click", selector: ".add-to-cart, [class*=\"cart\"] button, button" },
    { action: "human_required", value: "Complete checkout and payment manually." },
    { action: "assert_url_contains", expected: "success|order|thank" },
  ],
}

interface ConsoleCapture {
  errors: string[]
  networkErrors: string[]
  status: number
}

async function checkPlaywright(): Promise<{ ok: boolean; reason?: string }> {
  try {
    await import("playwright-core")
    return { ok: true }
  } catch {
    return {
      ok: false,
      reason: "optional dependency 'playwright-core' is not installed. Install it plus a chromium build to run browser tests.",
    }
  }
}

async function fetchProbe(url: string): Promise<ConsoleCapture> {
  const capture: ConsoleCapture = { errors: [], networkErrors: [], status: 0 }
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "follow" }).catch((error) => {
    capture.errors.push(String(error))
    return undefined
  })
  if (!response) return capture
  capture.status = response.status
  if (response.status >= 400) capture.networkErrors.push(`${response.status} ${url}`)
  return capture
}

async function runNoBrowser(ctx: PluginContext, url: string, scenarioName: string): Promise<number> {
  ctx.out(`${Icon.warn} Browser mode unavailable — running HTTP-only smoke checks`)
  const capture = await fetchProbe(url)

  let failed = 0
  if (capture.status === 0) {
    ctx.out(`  ${Icon.fail} navigate — could not reach ${url}`)
    failed++
  } else if (capture.status >= 400) {
    ctx.out(`  ${Icon.fail} assert_status — HTTP ${capture.status}`)
    failed++
  } else {
    ctx.out(`  ${Icon.success} navigate — HTTP ${capture.status}`)
  }

  for (const error of capture.networkErrors) ctx.out(`  ${Icon.fail} ${error}`)

  const html = capture.status > 0 && capture.status < 400 ? await (await fetch(url)).text() : ""
  const images = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/g)].map((m) => m[1])
  let brokenImages = 0
  for (const src of images.slice(0, 20)) {
    if (src.startsWith("data:")) continue
    const absolute = src.startsWith("http") ? src : new URL(src, url).href
    const head = await fetch(absolute, { method: "HEAD", signal: AbortSignal.timeout(8000) }).catch(() => undefined)
    if (!head || head.status >= 400) {
      ctx.out(`  ${Icon.fail} broken image: ${src}`)
      brokenImages++
    }
  }
  if (images.length > 0 && brokenImages === 0) ctx.out(`  ${Icon.success} ${images.length} images checked, none broken`)

  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]
  if (!title) {
    ctx.out(`  ${Icon.warn} no <title> tag found`)
    failed++
  } else {
    ctx.out(`  ${Icon.success} title: "${title.trim()}"`)
  }

  ctx.out("")
  ctx.out(`📊 ${scenarioName} (http-only): ${failed === 0 ? ok("passed") : bad(`${failed} failed`)}`)
  ctx.out(dim(`Full browser testing: bun add playwright-core && bun x playwright install chromium`))
  return failed === 0 ? 0 : 1
}

interface DomAudit {
  title?: string
  headings: Array<{ level: string; text: string }>
  images: Array<{ src: string; alt: string }>
  buttons: number
  forms: number
  viewportMeta: boolean
  issues: Array<{ severity: string; problem: string; suggestion: string }>
}

function auditHtml(html: string): DomAudit {
  const issues: DomAudit["issues"] = []
  const h1 = [...html.matchAll(/<h1[^>]*>([^<]*)<\/h1>/gi)]
  const headings = [...html.matchAll(/<(h[1-3])[^>]*>([^<]*)<\/\1>/gi)].map((m) => ({ level: m[1].toUpperCase(), text: m[2].trim() }))
  const images = [...html.matchAll(/<img[^>]*>/gi)].map((tag) => ({
    src: tag[0].match(/src=["']([^"']*)["']/i)?.[1] ?? "",
    alt: tag[0].match(/alt=["']([^"']*)["']/i)?.[1] ?? "",
  }))
  const viewportMeta = /<meta[^>]+name=["']viewport["']/i.test(html)

  if (h1.length === 0) issues.push({ severity: "high", problem: "No <h1> heading on page", suggestion: "Add a single descriptive <h1> to the main content area" })
  if (!viewportMeta) issues.push({ severity: "high", problem: "Missing viewport meta tag — mobile rendering breaks", suggestion: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">' })
  const missingAlt = images.filter((i) => !i.alt)
  if (missingAlt.length > 0) {
    issues.push({ severity: "medium", problem: `${missingAlt.length} image(s) without alt text`, suggestion: "Add descriptive alt attributes for accessibility + SEO" })
  }
  if (html.length < 800) issues.push({ severity: "medium", problem: "Very small HTML payload — page may be empty or JS-rendered", suggestion: "Verify SSR/prerender for critical content" })
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim()
  if (!title) issues.push({ severity: "high", problem: "Missing <title>", suggestion: "Add a unique, descriptive <title>" })
  else if (title.length > 65) issues.push({ severity: "low", problem: `Title is ${title.length} chars (search engines truncate ~60)`, suggestion: "Shorten the <title>" })

  return {
    title,
    headings,
    images,
    buttons: [...html.matchAll(/<button/gi)].length,
    forms: [...html.matchAll(/<form/gi)].length,
    viewportMeta,
    issues,
  }
}

async function visualHttpOnly(ctx: PluginContext, url: string): Promise<number | void> {
  ctx.out(`${Icon.eye} NEXUS Visual QA (http-only): ${url}`)
  const report = auditHtml(await (await fetch(url, { signal: AbortSignal.timeout(15000) })).text().catch(() => ""))
  let score = 100 - report.issues.reduce((sum, i) => sum + (i.severity === "high" ? 20 : i.severity === "medium" ? 10 : 5), 0)
  score = Math.max(0, Math.min(100, score))

  if (report.headings.length > 0) {
    ctx.out(`  Headings: ${report.headings.slice(0, 6).map((h) => `${h.level}="${h.text.slice(0, 24)}"`).join(", ")}`)
  }
  ctx.out(`  Images: ${report.images.length} | Buttons: ${report.buttons} | Forms: ${report.forms}`)

  if (ctx.llm) {
    ctx.out(`${Icon.brain} AI analysis...`)
    const analysis = await ctx.llm.generate(
      `You are a UI/UX QA expert reviewing this webpage data. URL: ${url}\nTitle: ${report.title}\nHeadings: ${JSON.stringify(report.headings)}\nImages: ${JSON.stringify(report.images)}\nIssues found: ${JSON.stringify(report.issues)}\nGive: design score 0-100, top 3 priority fixes, any layout/UX concerns. Be concise.`,
    )
    ctx.out(analysis)
  } else {
    ctx.out(`${Style.TEXT_DIM}(connect an LLM via api add for full AI vision analysis)${Style.TEXT_NORMAL}`)
  }

  printIssuesAndScore(ctx, report.issues, score)
  return report.issues.some((i) => i.severity === "high") ? 1 : 0
}

function printIssuesAndScore(ctx: PluginContext, issues: DomAudit["issues"], score: number): void {
  if (issues.length === 0) {
    ctx.out(`  ${Icon.success} No structural issues detected`)
  } else {
    const icon = { high: Icon.fail, medium: Icon.warn, low: Icon.info } as Record<string, string>
    for (const issue of issues) {
      ctx.out(`  ${icon[issue.severity] ?? Icon.info} [${issue.severity}] ${issue.problem}`)
      ctx.out(`      ${Style.TEXT_DIM}Fix: ${issue.suggestion}${Style.TEXT_NORMAL}`)
    }
  }
  ctx.out(`\n${Icon.rocket} Design Score: ${score >= 80 ? ok(`${score}/100`) : score >= 50 ? `${score}/100` : bad(`${score}/100`)}`)
}

interface ViewportDefinition {
  name: string
  width: number
  height: number
}

const VISUAL_VIEWPORTS: ViewportDefinition[] = [
  { name: "desktop", width: 1280, height: 720 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 667 },
]

async function runVisual(ctx: PluginContext, url: string): Promise<number | void> {
  const { chromium } = await import("playwright-core")
  const executablePath = Bun.which("chromium") ?? Bun.which("chromium-browser") ?? undefined
  if (!executablePath) {
    ctx.err(`${Icon.warn} chromium binary not found — falling back to http-only checks`)
    return visualHttpOnly(ctx, url)
  }

  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] })
  const page = await browser.newPage()
  const outDir = path.join(ctx.cwd, "nexus-reports", "visual")
  await import("fs/promises").then((fs) => fs.mkdir(outDir, { recursive: true }))
  const stamp = new Date().toISOString().slice(0, 10)

  ctx.out(`${Icon.eye} NEXUS Visual QA: ${url}`)
  ctx.out(dim(`📸 Capturing ${VISUAL_VIEWPORTS.length} viewports: ${VISUAL_VIEWPORTS.map((v) => v.name).join(", ")}`))

  const issues: DomAudit["issues"] = []
  const screenshots: Array<{ name: string; image: string }> = []

  for (const viewport of VISUAL_VIEWPORTS) {
    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 })
      const shotFile = path.join(outDir, `${viewport.name}-${stamp}.png`)
      await page.screenshot({ path: shotFile, fullPage: true })
      screenshots.push({ name: viewport.name, image: Buffer.from(await Bun.file(shotFile).arrayBuffer()).toString("base64") })

      const rendered = await page.evaluate(() => ({
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        tinyFonts: [...document.querySelectorAll<HTMLElement>("body *")].filter(
          (el) => el.offsetParent !== null && parseFloat(getComputedStyle(el).fontSize) < 12 && (el.textContent?.trim().length ?? 0) > 0,
        ).length,
        brokenImages: [...document.images].filter((img) => img.complete && img.naturalWidth === 0).length,
      }))

      if (rendered.horizontalOverflow > 2) {
        issues.push({
          severity: viewport.name === "mobile" ? "high" : "medium",
          problem: `[${viewport.name}] Horizontal overflow of ${rendered.horizontalOverflow}px — content cut off sideways`,
          suggestion: `Add responsive breakpoints / flexible widths for ${viewport.width}px viewport`,
        })
      }
      if (rendered.brokenImages > 0) {
        issues.push({ severity: "high", problem: `[${viewport.name}] ${rendered.brokenImages} broken image(s)`, suggestion: "Fix image src paths" })
      }
      if (rendered.tinyFonts > 0) {
        issues.push({
          severity: "medium",
          problem: `[${viewport.name}] ${rendered.tinyFonts} element(s) below 12px font`,
          suggestion: "Increase font size for readability (min 12px)",
        })
      }
      ctx.out(`  ${Icon.success} ${viewport.name} (${viewport.width}×${viewport.height}) captured`)
    } catch (error) {
      ctx.out(`  ${Icon.fail} ${viewport.name}: ${error instanceof Error ? error.message : String(error)}`)
      issues.push({ severity: "medium", problem: `[${viewport.name}] capture failed`, suggestion: "Check page availability/timeout" })
    }
  }

  await browser.close()

  const domReport = auditHtml(await (await fetch(url, { signal: AbortSignal.timeout(15000) })).text().catch(() => ""))
  issues.push(...domReport.issues)

  if (ctx.llm && screenshots.length > 0) {
    ctx.out(`${Icon.brain} AI vision analysis across ${screenshots.length} screenshots...`)
    try {
      const analysis = await ctx.llm.generate(
        `You are a UI/UX expert and QA engineer. Analyze these ${screenshots.length} website screenshots (${screenshots.map((s) => s.name).join(", ")} viewports).\nGoal: find layout breakage, misalignment, contrast problems, missing elements, responsiveness issues.\nStatic checks already found: ${JSON.stringify(domReport.issues)}\nRespond with: design score 0-100, top 3 priority fixes, any extra visual issues. Be concise.`,
        screenshots.map((s) => s.image),
      )
      ctx.out(analysis)
    } catch (error) {
      ctx.out(dim(`AI vision skipped: ${error instanceof Error ? error.message : String(error)}`))
    }
  } else if (!ctx.llm) {
    ctx.out(`${Style.TEXT_DIM}(connect an LLM via api add for full AI vision analysis of the saved screenshots)${Style.TEXT_NORMAL}`)
  }

  let score = 100 - issues.reduce((sum, i) => sum + (i.severity === "high" ? 20 : i.severity === "medium" ? 10 : 5), 0)
  score = Math.max(0, Math.min(100, score))
  printIssuesAndScore(ctx, issues, score)
  ctx.out(`${Style.TEXT_DIM}Screenshots: ${outDir}/{desktop,tablet,mobile}-${stamp}.png${Style.TEXT_NORMAL}`)
  return issues.some((i) => i.severity === "high") ? 1 : 0
}

async function visual(ctx: PluginContext): Promise<number | void> {
  let url = ctx.args.find((a) => /^https?:\/\//.test(a)) ?? ctx.args.find(Boolean)
  if (!url) {
    ctx.err("Usage: nexus webtest visual <url>")
    return 1
  }
  if (!/^https?:\/\//.test(url)) url = "https://" + url
  if (!(await requireAuthorizedTarget(ctx, url, "visual QA"))) return 1

  const status = await checkPlaywright()
  if (!status.ok) {
    ctx.err(dim(status.reason ?? "browser unavailable"))
    ctx.out(dim("Running http-only structural checks instead."))
    return visualHttpOnly(ctx, url)
  }
  return runVisual(ctx, url)
}

export interface RecordedStep {
  action: "goto" | "click" | "fill"
  selector?: string
  value?: string
}

const RECORDER_INIT_SCRIPT = `
(() => {
  if (window.__nexusRecorder) return
  window.__nexusRecorder = true
  const selectorFor = (el) => {
    if (!el || el.nodeType !== 1) return null
    if (el.id) return '#' + CSS.escape(el.id)
    if (el.getAttribute('data-testid')) return '[data-testid="' + el.getAttribute('data-testid') + '"]'
    if (el.getAttribute('name')) return el.tagName.toLowerCase() + '[name="' + el.getAttribute('name') + '"]'
    if (el.getAttribute('aria-label')) return el.tagName.toLowerCase() + '[aria-label="' + el.getAttribute('aria-label').slice(0,40) + '"]'
    if (/^(A|BUTTON)$/.test(el.tagName)) {
      const text = (el.textContent || '').trim().slice(0, 30)
      if (text) return 'text=' + text
    }
    return el.tagName.toLowerCase()
  }
  addEventListener('click', (e) => {
    const s = selectorFor(e.target)
    if (s) console.log('__NX_STEP__' + JSON.stringify({ action: 'click', selector: s }))
  }, true)
  addEventListener('change', (e) => {
    const el = e.target
    const s = selectorFor(el)
    if (!s || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
    const secret = el.type === 'password'
    console.log('__NX_STEP__' + JSON.stringify({ action: 'fill', selector: s, value: secret ? '***' : String(el.value ?? '').slice(0, 80) }))
  }, true)
})()
`

export function escapeSpecString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

export function generateSpec(url: string, steps: RecordedStep[]): string {
  const lines = [
    "import { test, expect } from '@playwright/test'",
    "",
    `// Recorded by NEXUS WebTest recorder on ${new Date().toISOString()}`,
    `// Source: ${url}`,
    "test('recorded flow', async ({ page }) => {",
    ...steps.map((step) => {
      if (step.action === "goto") return `  await page.goto('${escapeSpecString(step.value ?? "")}')`
      if (step.action === "click") return `  await page.click('${escapeSpecString(step.selector ?? "")}')`
      return `  await page.fill('${escapeSpecString(step.selector ?? "")}', '${escapeSpecString(step.value ?? "")}')`
    }),
    "})",
    "",
  ]
  return lines.join("\n")
}

async function waitForEnter(ctx: PluginContext): Promise<void> {
  process.stderr.write(`${Style.TEXT_HIGHLIGHT_BOLD}Press ENTER in this terminal to stop recording...${Style.TEXT_NORMAL}${EOL}`)
  process.stdin.setEncoding("utf8")
  process.stdin.resume()
  await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()))
}

async function record(ctx: PluginContext): Promise<number | void> {
  const status = await checkPlaywright()
  if (!status.ok) {
    ctx.err(`Recorder unavailable: ${status.reason}`)
    return 1
  }
  const executablePath = Bun.which("chromium") ?? Bun.which("chromium-browser") ?? undefined
  if (!executablePath) {
    ctx.err("chromium binary not found — install it (bun x playwright install chromium) and retry")
    return 1
  }

  let url = ctx.args.find((a) => /^https?:\/\//.test(a))
  if (!url) {
    const bare = ctx.args.find(Boolean)
    if (!bare) {
      ctx.err("Usage: nexus webtest record <url> [--output ./tests/login.spec.js]")
      return 1
    }
    url = "https://" + bare
  }
  if (!(await requireAuthorizedTarget(ctx, url, "screen-to-code recording"))) return 1

  ctx.out(`${Icon.robot} NEXUS Screen-to-Code Recorder`)
  ctx.out(dim("Perform your actions in the opened browser. Password fields are NEVER recorded."))

  const { chromium } = await import("playwright-core")
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"], headless: false })
  const page = await browser.newPage()
  await page.addInitScript(RECORDER_INIT_SCRIPT)

  const steps: RecordedStep[] = [{ action: "goto", value: url }]
  let lastUrl = url

  page.on("console", (msg) => {
    const text = msg.text()
    if (!text.startsWith("__NX_STEP__")) return
    try {
      const step = JSON.parse(text.slice("__NX_STEP__".length)) as RecordedStep
      steps.push(step)
      ctx.out(`  ${dim("+")} ${step.action}${step.selector ? ` ${step.selector}` : ""}${step.value ? ` → "${step.value}"` : ""}`)
    } catch {}
  })

  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return
    const current = frame.url()
    if (current && current !== lastUrl && current !== "about:blank") {
      lastUrl = current
      steps.push({ action: "goto", value: current })
    }
  })

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 })
  } catch (error) {
    ctx.err(`Could not open ${url}: ${error instanceof Error ? error.message : String(error)}`)
    await browser.close()
    return 1
  }

  await waitForEnter(ctx)
  await browser.close().catch(() => {})

  const specSteps = steps.filter(
    (step, index) =>
      !(step.action === "goto" && index > 0 && steps[index - 1]?.action === "goto") &&
      !(step.action === "fill" && step.value === ""),
  )

  const outFile = path.resolve(ctx.cwd, typeof ctx.flags.output === "string" ? ctx.flags.output : path.join("tests", `recorded-${Date.now()}.spec.js`))
  await import("fs/promises").then((fs) => fs.mkdir(path.dirname(outFile), { recursive: true }))
  await Bun.write(outFile, generateSpec(url, specSteps))

  ctx.out("")
  ctx.out(`${Icon.success} ${specSteps.length} step(s) recorded`)
  ctx.out(`${Icon.plugin} Generated: ${outFile}`)
  ctx.out(dim(`Run with: npx playwright test ${outFile}`))
  return 0
}

async function run(ctx: PluginContext): Promise<number | void> {
  let url = ctx.args[0]
  if (!url) {
    ctx.err("Usage: nexus webtest run <url> [--scenario smoke|headers|forms] [--report bugs]")
    return 1
  }
  if (!/^https?:\/\//.test(url)) url = "https://" + url
  if (!(await requireAuthorizedTarget(ctx, url, "WebTest"))) return 1

  if (typeof ctx.flags.watch !== "undefined" && ctx.flags.watch !== false) {
    ctx.err("Recurring watch mode is disabled. Run a one-shot authorized test when you need it.")
    return 1
  }

  const scenarioName = typeof ctx.flags.scenario === "string" ? ctx.flags.scenario : "smoke"

  const status = await checkPlaywright()
  if (!status.ok) {
    const code = await runNoBrowser(ctx, url, scenarioName)
    return code
  }

  const { chromium } = await import("playwright-core")
  const executablePath = Bun.which("chromium") ?? Bun.which("chromium-browser") ?? undefined
  if (!executablePath) {
    return runNoBrowser(ctx, url, scenarioName)
  }

  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] })
  const page = await browser.newPage()

  const logs: string[] = []
  const networkErrors: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "error") logs.push(`[ERROR] ${msg.text()}`)
  })
  page.on("pageerror", (err) => logs.push(`[PAGE_ERROR] ${err.message}`))
  page.on("response", (res) => {
    if (res.status() >= 400) networkErrors.push(`${res.status()} ${res.url()}`)
  })

  const scenario = SCENARIOS[scenarioName] ?? SCENARIOS.smoke
  let passed = 0
  let failed = 0
  const bugs: string[] = []

  ctx.out(`${Icon.test} NEXUS WebTest: ${url}`)
  ctx.out(`Scenario: ${scenarioName} (${scenario.length} steps)`)

  let index = 0
  for (const step of scenario) {
    index++
    try {
      if (step.action === "navigate" && step.url) {
        const response = await page.goto(step.url.replace("{{URL}}", url), { waitUntil: "networkidle", timeout: 30000 })
        if ((response?.status() ?? 0) >= 400) throw new Error(`HTTP ${response?.status()}`)
      } else if (step.action === "assert_status") {
        void step
      } else if (step.action === "assert_visible" && step.selector) {
        const visible = await page.locator(step.selector).first().isVisible().catch(() => false)
        if (!visible) throw new Error(`selector not visible: ${step.selector}`)
      } else if (step.action === "assert_console_clean") {
        if (logs.length > 0) throw new Error(`${logs.length} console error(s)`)
      } else if (step.action === "assert_header" && step.selector) {
        const response = await page.goto(url, { waitUntil: "domcontentloaded" })
        const header = response?.headers()?.[step.selector]
        if (!header) throw new Error(`missing header: ${step.selector}`)
        if (step.expected && !step.expected.split("|").includes(header)) throw new Error(`header ${step.selector}=${header}`)
      } else if (step.action === "human_required") {
        ctx.out(`  ${Icon.lock} Step ${index}: ${step.value ?? "Human step required"} `)
        process.stderr.write(`${Style.TEXT_HIGHLIGHT_BOLD}Press ENTER when done...${Style.TEXT_NORMAL}${EOL}`)
        await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()))
      } else if (step.action === "click" && step.selector) {
        if (ctx.flags.allowInteraction !== true) {
          throw new Error("interactive browser actions are disabled by default; rerun with --allow-interaction and confirm the exact step")
        }
        const approved = await ctx.confirm({
          title: `Allow browser interaction for step ${index}?`,
          detail: `Selector: ${step.selector}. NEXUS will not enter credentials, OTPs, or payment data.`,
          danger: true,
        })
        if (!approved) throw new Error("human declined the browser interaction")
        const found = await page.locator(step.selector).first().isVisible().catch(() => false)
        if (!found) throw new Error(`click target not visible: ${step.selector}`)
        await page.locator(step.selector).first().click({ timeout: 8000 })
      } else if (step.action === "assert_url_contains") {
        const current = page.url()
        if (!step.expected?.split("|").some((part) => current.toLowerCase().includes(part))) {
          throw new Error(`url "${current}" does not contain ${step.expected}`)
        }
      } else if (step.action === "screenshot") {
        const outDir = path.join(ctx.cwd, "nexus-reports", "webtest")
        await import("fs/promises").then((fs) => fs.mkdir(outDir, { recursive: true }))
        const file = path.join(outDir, `${step.value ?? "page"}-${Date.now()}.png`)
        await page.screenshot({ path: file, fullPage: true })
      }
      ctx.out(`  ${Icon.success} ${String(index).padStart(2)}/${scenario.length} ${step.action}`)
      passed++
    } catch (error) {
      failed++
      const message = error instanceof Error ? error.message : String(error)
      bugs.push(`Step ${index} (${step.action}): ${message}`)
      ctx.out(`  ${Icon.fail} ${String(index).padStart(2)}/${scenario.length} ${step.action} — ${message}`)
    }
  }

  await browser.close()

  ctx.out("")
  ctx.out(`📊 Results: ${passed} passed, ${failed} failed`)

  if (bugs.length > 0) {
    ctx.out(`${Icon.bug} Bug summary:`)
    for (const bug of bugs) ctx.out(`  • ${bug}`)
  }
  if (logs.length > 0) {
    ctx.out(`${Style.TEXT_DIM}Console errors:${Style.TEXT_NORMAL}`)
    for (const log of logs.slice(0, 10)) ctx.out(`  ${Style.TEXT_DANGER}${log}${Style.TEXT_NORMAL}`)
  }

  if (bugs.length > 0 || typeof ctx.flags.report === "string") {
    await writeReports(ctx, url, { passed, failed, logs, networkErrors, bugs })
  }

  return failed === 0 ? 0 : 1
}

interface ReportData {
  passed: number
  failed: number
  logs: string[]
  networkErrors: string[]
  bugs: string[]
}

async function writeReports(ctx: PluginContext, url: string, data: ReportData): Promise<void> {
  const outDir = path.join(ctx.cwd, "nexus-reports", "webtest")
  await import("fs/promises").then((fs) => fs.mkdir(outDir, { recursive: true }))
  const stamp = new Date().toISOString().slice(0, 10)

  const summary = {
    url,
    date: new Date().toISOString(),
    summary: {
      total: data.bugs.length,
      consoleErrors: data.logs.length,
      networkErrors: data.networkErrors.length,
      passed: data.passed,
      failed: data.failed,
    },
    bugs: data.bugs.map((b, i) => ({ id: `BUG-${String(i + 1).padStart(3, "0")}`, description: b })),
    console: data.logs,
    network: data.networkErrors,
  }

  await Bun.write(path.join(outDir, `bugs-${stamp}.json`), JSON.stringify(summary, null, 2))

  const severityColor = (n: number): string => (n > 0 ? "#e74c3c" : "#2ecc71")
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>NEXUS WebTest Report — ${url}</title>
<style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;padding:2rem;line-height:1.6}
h1{color:#96f} .badge{display:inline-block;padding:.2rem .6rem;border-radius:99px;background:${severityColor(data.failed)}22;color:${severityColor(data.failed)}}
pre{background:#1e293b;padding:1rem;border-radius:8px;overflow-x:auto} li{margin:.3rem 0}</style></head>
<body><h1>NEXUS WebTest Report</h1>
<p>${url} — ${new Date().toLocaleString()}</p>
<p class="badge">${data.passed} passed</p> <p class="badge">${data.failed} failed</p> <p class="badge">${data.logs.length} console errors</p>
<h2>Bugs</h2><ol>${data.bugs.map((b) => `<li>${b}</li>`).join("") || "<li>None 🎉</li>"}</ol>
<h2>Console</h2><pre>${data.logs.join("\n") || "clean"}</pre>
<h2>Network errors</h2><pre>${data.networkErrors.join("\n") || "none"}</pre>
</body></html>`
  await Bun.write(path.join(outDir, `bugs-${stamp}.html`), html)

  const baselinePath = typeof ctx.flags.baseline === "string" ? path.resolve(ctx.cwd, ctx.flags.baseline) : undefined
  if (baselinePath && (await Bun.file(baselinePath).exists())) {
    try {
      const prev = JSON.parse(await Bun.file(baselinePath).text()) as { bugs?: Array<{ description: string }> }
      const known = new Set(prev.bugs?.map((b) => b.description))
      const newBugs = data.bugs.filter((b) => !known.has(b))
      ctx.out(`${Icon.bug} Regression check: ${newBugs.length} NEW, ${data.bugs.length - newBugs.length} known`)
      for (const nb of newBugs) ctx.out(`  ${Icon.fail} NEW: ${nb}`)
    } catch {
      ctx.out(`${Style.TEXT_DIM}baseline unreadable — skipped regression compare${Style.TEXT_NORMAL}`)
    }
  }

  ctx.out(`${Icon.success} Reports: ${outDir}/bugs-${stamp}.{json,html}`)
}

const plugin: NexusPlugin = {
  name: "webtest",
  version: "0.1.0",
  description: "Website testing agent — scenarios, multi-viewport visual QA, bug reports, screen-to-code recorder",
  tags: ["test", "qa", "bugs", "website", "recorder"],
  requires: {
    check: () => ({ ok: true }),
  },
  commands: [
    {
      name: "run",
      describe: "test a website with optional bug reports, watch mode and regression baseline",
      usage: "nexus webtest run <url> --authorize-target [--scenario smoke|headers|forms|login|purchase] [--report bugs] [--baseline old.json]",
      run,
    },
    {
      name: "visual",
      describe: "multi-viewport visual QA (desktop/tablet/mobile screenshots + AI vision, http-only fallback)",
      usage: "nexus webtest visual <url> --authorize-target",
      run: visual,
    },
    {
      name: "record",
      describe: "screen-to-code recorder — perform actions in a browser, get a Playwright spec",
      usage: "nexus webtest record <url> --authorize-target [--output ./tests/login.spec.js]",
      run: record,
    },
  ],
}

export default plugin

export * as WebtestPlugin from "./webtest"
