import { EOL } from "os"
import { Style } from "./style"
import type { HitlRequest, PluginContext } from "./types"

const SENSITIVE_URL_PATTERNS = [
  "login",
  "signin",
  "sign-in",
  "auth",
  "2fa",
  "otp",
  "verify",
  "challenge",
  "cpsess",
  "wp-login",
]

const SENSITIVE_ACTIONS = [
  "delete",
  "remove",
  "drop",
  "destroy",
  "payment",
  "purchase",
  "buy",
  "password",
  "revoke",
]

export function isSensitiveUrl(url: string): boolean {
  const lower = url.toLowerCase()
  return SENSITIVE_URL_PATTERNS.some((p) => lower.includes(p))
}

export function isSensitiveAction(text: string): boolean {
  const lower = text.toLowerCase()
  return SENSITIVE_ACTIONS.some((p) => lower.includes(p))
}

export async function requireAuthorizedTarget(ctx: PluginContext, url: string, operation: string): Promise<boolean> {
  if (ctx.flags.authorizeTarget !== true) {
    ctx.err(`Refusing ${operation}: pass --authorize-target only for a website you own or are authorized to test.`)
    return false
  }
  let origin: string
  try {
    origin = new URL(url).origin
  } catch {
    ctx.err(`Invalid target URL: ${url}`)
    return false
  }
  const approved = await ctx.confirm({
    title: `Authorize ${operation} for ${origin}?`,
    detail: "Confirm that you own this target or have permission to test it. NEXUS will not use passwords, OTPs, CAPTCHA bypasses, or exported sessions.",
    danger: isSensitiveUrl(url),
  })
  if (!approved) ctx.out("Target authorization cancelled")
  return approved
}

export const SECURITY_RULES = [
  "NO password storage — API tokens/SSH keys only",
  "NO OTP interception — never read SMS, email or authenticator codes",
  "NO CAPTCHA bypass — always human-in-the-loop",
  "NO auto-login — never fill login forms automatically",
  "Session reuse — only a NEXUS-owned isolated profile or a user-started loopback CDP browser",
  "Explicit consent — dangerous actions require yes/no confirmation",
  "Audit log — record what was done, never credentials",
]

export async function confirmViaStdin(request: HitlRequest): Promise<boolean> {
  if (process.env.NEXUS_ASSUME_YES === "1") return true
  if (process.env.NEXUS_ASSUME_YES === "0") return false
  const icon = request.danger ? `${Style.TEXT_WARNING}⚠️` : `${Style.TEXT_INFO}🔐`
  process.stderr.write(`${EOL}${icon} ${request.title}${Style.TEXT_NORMAL}${EOL}`)
  if (request.detail) process.stderr.write(`${Style.TEXT_DIM}${request.detail}${Style.TEXT_NORMAL}${EOL}`)
  if (request.danger) {
    process.stderr.write(`${Style.TEXT_DIM}NEXUS never asks for passwords or OTPs.${Style.TEXT_NORMAL}${EOL}`)
  }
  process.stderr.write(`${Style.TEXT_HIGHLIGHT_BOLD}Proceed? [y/N] ${Style.TEXT_NORMAL}`)
  const answer = await readLine()
  return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes"
}

type ReadableInput = Pick<typeof process.stdin, "setEncoding" | "resume" | "pause" | "on" | "removeListener">

export function createBufferedLineReader(stdin: ReadableInput = process.stdin) {
  let pendingStdin = ""

  return function readLine(): Promise<string> {
    return new Promise((resolve) => {
      const takeBufferedLine = () => {
        const index = pendingStdin.indexOf(EOL)
        if (index === -1) return false
        const line = pendingStdin.slice(0, index)
        pendingStdin = pendingStdin.slice(index + EOL.length)
        resolve(line)
        return true
      }

      if (takeBufferedLine()) return

      const onData = (chunk: string) => {
        pendingStdin += chunk
        if (!takeBufferedLine()) return
        stdin.removeListener("data", onData)
        stdin.pause()
      }

      stdin.setEncoding("utf8")
      stdin.resume()
      stdin.on("data", onData)
    })
  }
}

const readLine = createBufferedLineReader()

export function makeContext(base: Omit<PluginContext, "confirm">): PluginContext {
  return {
    ...base,
    confirm: (request) => base.flags.confirm === true ? Promise.resolve(true) : confirmViaStdin(request),
  }
}

export function audit(action: string, detail: Record<string, unknown>) {
  const safe = JSON.stringify({ ts: Date.now(), action, ...detail })
  process.env.NEXUS_AUDIT && process.stderr.write(`${Style.TEXT_DIM}[audit] ${safe}${Style.TEXT_NORMAL}${EOL}`)
}

export * as Security from "./security"
