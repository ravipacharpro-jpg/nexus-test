import { parseBrowserHandoffTarget } from "./browser-handoff"

export type BrowserSessionState =
  | "idle"
  | "opening"
  | "awaiting_user"
  | "authenticated"
  | "completed"
  | "blocked"
  | "cancelled"
export type BrowserPauseReason = "login" | "otp" | "captcha" | "approval" | "unknown_sensitive_step"

export type BrowserAction = {
  kind: "navigate" | "inspect" | "click" | "type"
  target: string
  requiresTakeover: boolean
  reason?: BrowserPauseReason
}

export function planBrowserAction(input: { kind: BrowserAction["kind"]; target: string }): BrowserAction {
  const reason = detectSensitiveBrowserStep(input.target)
  return {
    kind: input.kind,
    target: input.target,
    requiresTakeover: Boolean(reason),
    ...(reason ? { reason } : {}),
  }
}

export type BrowserSessionEvent = {
  state: BrowserSessionState
  reason?: BrowserPauseReason
  message: string
  url?: string
}

export type BrowserSession = {
  state: BrowserSessionState
  url?: string
  pauseReason?: BrowserPauseReason
  begin: (url: string) => BrowserSessionEvent
  requestTakeover: (reason: BrowserPauseReason) => BrowserSessionEvent
  resumeAfterTakeover: (authenticated: boolean) => BrowserSessionEvent
  complete: () => BrowserSessionEvent
  cancel: () => BrowserSessionEvent
}

const sensitiveSignals: Array<[RegExp, BrowserPauseReason]> = [
  [/captcha|recaptcha|i.?m not a robot/i, "captcha"],
  [/one.?time|otp|verification code|authenticator/i, "otp"],
  [/password|sign in|log in|login|username|email address/i, "login"],
  [/approve|confirm purchase|send|publish|delete|merge|payment/i, "approval"],
]

export function detectSensitiveBrowserStep(text: string): BrowserPauseReason | undefined {
  for (const [pattern, reason] of sensitiveSignals) if (pattern.test(text)) return reason
  return undefined
}

export function createBrowserSession(options: { launch: (url: string) => Promise<void> }): BrowserSession {
  let state: BrowserSessionState = "idle"
  let url: string | undefined
  let pauseReason: BrowserPauseReason | undefined
  const event = (message: string): BrowserSessionEvent => ({
    state,
    ...(pauseReason ? { reason: pauseReason } : {}),
    ...(url ? { url } : {}),
    message,
  })

  return {
    get state() {
      return state
    },
    get url() {
      return url
    },
    get pauseReason() {
      return pauseReason
    },
    begin(target: string) {
      if (state !== "idle") throw new Error("Browser session has already started")
      url = parseBrowserHandoffTarget(target).launchUrl
      state = "opening"
      void options.launch(url).catch(() => {
        state = "blocked"
      })
      return event("Browser opened; safe navigation is in progress.")
    },
    requestTakeover(reason: BrowserPauseReason) {
      if (state !== "opening" && state !== "authenticated")
        throw new Error("Browser session is not awaiting a sensitive step")
      pauseReason = reason
      state = "awaiting_user"
      return event(
        reason === "approval"
          ? "User approval is required before continuing this browser action."
          : "User takeover is required; enter sensitive details in the browser and return when access is ready.",
      )
    },
    resumeAfterTakeover(authenticated: boolean) {
      if (state !== "awaiting_user") throw new Error("Browser session is not awaiting user takeover")
      if (!authenticated) {
        state = "blocked"
        return event("Browser access was not confirmed; the task remains safely blocked.")
      }
      state = "authenticated"
      return event("Browser access confirmed without importing or storing sensitive details.")
    },
    complete() {
      if (state !== "authenticated") throw new Error("Browser access must be confirmed before completion")
      state = "completed"
      return event("Browser task completed after authenticated access confirmation.")
    },
    cancel() {
      state = "cancelled"
      return event("Browser task cancelled; no sensitive details were captured.")
    },
  }
}

export * as BrowserSession from "./browser-session"
