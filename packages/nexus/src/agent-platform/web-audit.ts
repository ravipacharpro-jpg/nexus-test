import { parseBrowserHandoffTarget } from "./browser-handoff"

export type WebAuditFinding = {
  severity: "info" | "warning" | "error"
  kind: "button" | "link" | "form" | "accessibility" | "resource"
  message: string
}

export type WebAuditResult = {
  url: string
  status: number
  title?: string
  controls: { buttons: number; links: number; forms: number }
  findings: WebAuditFinding[]
  submitted: false
}

function count(html: string, pattern: RegExp) {
  return [...html.matchAll(pattern)].length
}

export function auditWebHtml(input: { url: string; status: number; html: string }): WebAuditResult {
  const target = parseBrowserHandoffTarget(input.url).launchUrl
  const html = input.html
  const findings: WebAuditFinding[] = []
  const buttons = count(html, /<button\b/gi) + count(html, /<input\b[^>]*type=["'](?:button|submit)["']/gi)
  const links = count(html, /<a\b/gi)
  const forms = count(html, /<form\b/gi)
  if (input.status >= 400)
    findings.push({ severity: "error", kind: "resource", message: `Page returned HTTP ${input.status}.` })
  if (buttons > 0 && /<button\b[^>]*>\s*<\/button>/i.test(html))
    findings.push({
      severity: "warning",
      kind: "accessibility",
      message: "Interactive buttons may be missing visible text labels.",
    })
  if (forms > 0 && !/<form\b[^>]*action=/i.test(html))
    findings.push({
      severity: "warning",
      kind: "form",
      message: "A form has no explicit action; submit behavior requires interactive verification.",
    })
  if (links > 0 && /<a\b[^>]*href=["'](?:javascript:[^"']*|#[^"']*)["']/i.test(html))
    findings.push({
      severity: "warning",
      kind: "link",
      message: "A link uses a javascript or fragment-only target and needs browser interaction verification.",
    })
  if (buttons === 0 && links === 0 && forms === 0)
    findings.push({
      severity: "info",
      kind: "resource",
      message: "No standard interactive controls were found in the fetched HTML.",
    })
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim()
  return {
    url: target,
    status: input.status,
    ...(title ? { title } : {}),
    controls: { buttons, links, forms },
    findings,
    submitted: false,
  }
}

export * as WebAudit from "./web-audit"
