import type { AssistantMessage } from "@nexus-ai/sdk/v2"
import { routeKey } from "./auto-model"

const QUARANTINE_KEY = "auto_route_quarantine"
const COOLDOWN_KEY = "auto_route_cooldowns"
const DEFAULT_COOLDOWN_MS = 60_000

type KV = {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

export type GoneNotice = {
  title: string
  message: string
}

// Only routes selected by Auto are quarantined. A manual model choice keeps
// precedence even when that request fails.
const autoRoutes = new Map<string, Set<string>>()

export function markAutoRoute(sessionID: string, providerID: string, modelID: string) {
  const routes = autoRoutes.get(sessionID) ?? new Set<string>()
  routes.add(routeKey(providerID, modelID))
  autoRoutes.set(sessionID, routes)
}

function isAutoRoute(sessionID: string, providerID: string, modelID: string) {
  return autoRoutes.get(sessionID)?.has(routeKey(providerID, modelID)) === true
}

type GoneCandidate = {
  sessionID: string
  role: string
  error?: AssistantMessage["error"]
  providerID?: string
  modelID?: string
}

export function goneRoute(message: Pick<AssistantMessage, "error" | "providerID" | "modelID">) {
  const error = message.error
  if (!error || error.name !== "APIError" || error.data.statusCode !== 410) return undefined
  return { providerID: message.providerID, modelID: message.modelID }
}

type Cooldown = { route: string; until: number }

function activeCooldowns(kv: KV, now = Date.now()) {
  const value = kv.get(COOLDOWN_KEY)
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Cooldown => {
    if (!item || typeof item !== "object") return false
    const candidate = item as Partial<Cooldown>
    return typeof candidate.route === "string" && typeof candidate.until === "number" && candidate.until > now
  })
}

export function quarantinedRoutes(kv: KV, now = Date.now()) {
  const value = kv.get(QUARANTINE_KEY)
  const permanent = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  return [...new Set([...permanent, ...activeCooldowns(kv, now).map((item) => item.route)])]
}

export function coolingDownRoutes(kv: KV, now = Date.now()) {
  return activeCooldowns(kv, now).map((item) => item.route)
}

export function quarantineRoute(kv: KV, providerID: string, modelID: string) {
  const key = routeKey(providerID, modelID)
  const value = kv.get(QUARANTINE_KEY)
  const routes = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  if (routes.includes(key)) return
  kv.set(QUARANTINE_KEY, [...routes, key])
}

export function quotaRoute(message: Pick<AssistantMessage, "error" | "providerID" | "modelID">) {
  const error = message.error
  if (!error || error.name !== "APIError") return undefined
  const text = error.data.message.toLowerCase()
  const quota = error.data.statusCode === 429 || /quota|rate.?limit|too many requests|resource exhausted/.test(text)
  if (!quota) return undefined
  const header = error.data.responseHeaders?.["retry-after"] ?? error.data.responseHeaders?.["Retry-After"]
  const seconds = header ? Number(header) : Number.NaN
  const retryAfter = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined
  const match = error.data.message.match(/(?:retry|try again|available).*?(\d+(?:\.\d+)?)\s*s/i)
  const messageDelay = match ? Number(match[1]) * 1000 : undefined
  return {
    providerID: message.providerID,
    modelID: message.modelID,
    cooldownMs: retryAfter ?? messageDelay ?? DEFAULT_COOLDOWN_MS,
  }
}

export function cooldownRoute(kv: KV, providerID: string, modelID: string, cooldownMs: number, now = Date.now()) {
  const route = routeKey(providerID, modelID)
  const next = activeCooldowns(kv, now).filter((item) => item.route !== route)
  kv.set(COOLDOWN_KEY, [...next, { route, until: now + Math.max(0, cooldownMs) }])
}

type Notify = (notice: { title?: string; message: string; variant: "info" | "success" | "warning" | "error"; duration?: number }) => void

export function recordGoneRoute(
  message: GoneCandidate,
  deps: { kv: KV; notify: Notify },
): { quarantined: boolean } | undefined {
  if (message.role !== "assistant") return undefined
  const route = { error: message.error, providerID: message.providerID ?? "", modelID: message.modelID ?? "" }
  const gone = goneRoute(route)
  if (gone) {
    if (!isAutoRoute(message.sessionID, gone.providerID, gone.modelID)) return { quarantined: false }
    const first = !quarantinedRoutes(deps.kv).includes(routeKey(gone.providerID, gone.modelID))
    if (!first) return { quarantined: true }
    quarantineRoute(deps.kv, gone.providerID, gone.modelID)
    deps.notify({
      title: "Model unavailable",
      message: `${routeKey(gone.providerID, gone.modelID)} returned 410 (EOL). Auto will skip this route; resend your request or pick another model.`,
      variant: "warning",
      duration: 6000,
    })
    return { quarantined: true }
  }
  const quota = quotaRoute(route)
  if (!quota) return undefined
  if (!isAutoRoute(message.sessionID, quota.providerID, quota.modelID)) return { quarantined: false }
  const key = routeKey(quota.providerID, quota.modelID)
  if (quarantinedRoutes(deps.kv).includes(key)) return { quarantined: true }
  cooldownRoute(deps.kv, quota.providerID, quota.modelID, quota.cooldownMs)
  deps.notify({
    title: "Model temporarily unavailable",
    message: `${key} reported a quota or rate limit. Auto will pause this route and try another eligible route.`,
    variant: "warning",
    duration: 6000,
  })
  return { quarantined: true }
}
