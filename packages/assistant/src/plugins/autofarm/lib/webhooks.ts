// Webhook system for NEXUS autofarm
// Allows NEXUS to notify external services (Slack, Discord, Telegram, custom)
// on important events: key exhaustion, farm success, errors, etc.
//
// Why: NEXUS runs as background service on Termux/Linux; user needs visibility
// without checking logs. This is THE production-grade notification layer.
//
// Usage:
//   import { webhookManager, sendWebhook, WebhookEvent } from "./lib/webhooks.ts"
//   sendWebhook({ kind: "key-exhausted", provider: "groq", daysToExhaust: 0.5 })
//
// Config: ~/.nexus/autofarm/webhooks.json
// {
//   "slack": { "url": "https://hooks.slack.com/services/...", "events": ["key-exhausted"] },
//   "discord": { "url": "https://discord.com/api/webhooks/...", "events": ["all"] },
//   "telegram": { "botToken": "123:ABC", "chatId": "456", "events": ["all"] },
//   "generic": [{ "url": "https://example.com/hook", "events": ["farm-success"], "secret": "..." }]
// }

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
import { log } from "./logger.ts"

export type WebhookEventKind =
  | "key-exhausted"
  | "key-recovered"
  | "farm-success"
  | "farm-failed"
  | "captcha-needed"
  | "gmail-created"
  | "fixer-applied"
  | "anomaly-detected"
  | "system-error"
  | "loop-started"
  | "loop-stopped"
  | "master-report"
  | "all"

export interface WebhookEvent {
  kind: WebhookEventKind
  ts: string
  message: string
  data?: Record<string, unknown>
  provider?: string
  level?: "info" | "warn" | "error" | "ok"
}

export interface SlackConfig {
  url: string
  events?: WebhookEventKind[]
  /** Optional override channel override */
  channel?: string
  username?: string
}

export interface DiscordConfig {
  url: string
  events?: WebhookEventKind[]
  username?: string
}

export interface TelegramConfig {
  botToken: string
  chatId: string
  events?: WebhookEventKind[]
}

export interface GenericConfig {
  url: string
  method?: "POST" | "PUT"
  headers?: Record<string, string>
  secret?: string // for HMAC-SHA256 signature
  events?: WebhookEventKind[]
}

export interface WebhookConfig {
  slack?: SlackConfig
  discord?: DiscordConfig
  telegram?: TelegramConfig
  generic?: GenericConfig[]
  /** Min event level to fire any webhook. Default: "warn". */
  minLevel?: "info" | "warn" | "error"
  /** Disable globally */
  enabled?: boolean
}

const CONFIG_PATH = path.join(os.homedir(), ".nexus", "autofarm", "webhooks.json")
const DEFAULT_CONFIG: WebhookConfig = { enabled: true, minLevel: "warn" }

function loadConfig(): WebhookConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return DEFAULT_CONFIG
    return { ...DEFAULT_CONFIG, ...(JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as WebhookConfig) }
  } catch (e) {
    log.warn("webhook", `load config failed: ${(e as Error).message}`)
    return DEFAULT_CONFIG
  }
}

export function saveConfig(cfg: WebhookConfig): void {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 })
    log.ok("webhook", "config saved")
  } catch (e) {
    log.error("webhook", `save config failed: ${(e as Error).message}`)
  }
}

export function getConfig(): WebhookConfig {
  return loadConfig()
}

function levelFor(kind: WebhookEventKind): "info" | "warn" | "error" | "ok" {
  switch (kind) {
    case "system-error":
    case "farm-failed":
    case "key-exhausted":
      return "error"
    case "captcha-needed":
    case "anomaly-detected":
    case "fixer-applied":
      return "warn"
    case "key-recovered":
    case "gmail-created":
    case "farm-success":
    case "loop-started":
    case "loop-stopped":
    case "master-report":
      return "ok"
    default:
      return "info"
  }
}

function shouldFire(cfg: WebhookConfig, event: WebhookEvent): boolean {
  if (cfg.enabled === false) return false
  if (event.kind === "all") return false
  if (cfg.minLevel === "error" && levelFor(event.kind) !== "error") return false
  if (cfg.minLevel === "warn" && !["error", "warn"].includes(levelFor(event.kind))) return false
  return true
}

function shouldFireForKind(subscribed: WebhookEventKind[] | undefined, kind: WebhookEventKind): boolean {
  if (!subscribed || subscribed.length === 0) return true
  if (subscribed.includes("all")) return true
  return subscribed.includes(kind)
}

// ── Adapters ────────────────────────────────────────────────────────

async function fireSlack(cfg: SlackConfig, ev: WebhookEvent): Promise<{ ok: boolean; error?: string }> {
  if (!shouldFireForKind(cfg.events, ev.kind)) return { ok: true }
  const colorByLevel: Record<string, string> = { info: "#36a64f", warn: "#daa038", error: "#d00000", ok: "#2eb886" }
  const color = colorByLevel[levelFor(ev.kind)] ?? "#36a64f"
  const payload = {
    username: cfg.username ?? "NEXUS autofarm",
    channel: cfg.channel,
    attachments: [
      {
        color,
        title: ev.kind,
        text: ev.message,
        fields: ev.data
          ? Object.entries(ev.data).slice(0, 8).map(([k, v]) => ({ title: k, value: String(v), short: true }))
          : undefined,
        ts: Math.floor(new Date(ev.ts).getTime() / 1000),
      },
    ],
  }
  try {
    const r = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })
    if (!r.ok) return { ok: false, error: `slack HTTP ${r.status}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

async function fireDiscord(cfg: DiscordConfig, ev: WebhookEvent): Promise<{ ok: boolean; error?: string }> {
  if (!shouldFireForKind(cfg.events, ev.kind)) return { ok: true }
  const colorByLevel: Record<string, number> = { info: 0x36a64f, warn: 0xdaa038, error: 0xd00000, ok: 0x2eb886 }
  const payload = {
    username: cfg.username ?? "NEXUS autofarm",
    embeds: [
      {
        title: ev.kind,
        description: ev.message,
        color: colorByLevel[levelFor(ev.kind)] ?? 0x36a64f,
        fields: ev.data
          ? Object.entries(ev.data).slice(0, 8).map(([k, v]) => ({ name: k, value: String(v), inline: true }))
          : undefined,
        timestamp: ev.ts,
      },
    ],
  }
  try {
    const r = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })
    if (!r.ok) return { ok: false, error: `discord HTTP ${r.status}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

async function fireTelegram(cfg: TelegramConfig, ev: WebhookEvent): Promise<{ ok: boolean; error?: string }> {
  if (!shouldFireForKind(cfg.events, ev.kind)) return { ok: true }
  const lvl = levelFor(ev.kind)
  const emoji = lvl === "error" ? "🔴" : lvl === "warn" ? "🟡" : lvl === "ok" ? "🟢" : "ℹ️"
  const text = `${emoji} *${ev.kind}*\n${ev.message}${ev.provider ? `\nprovider: \`${ev.provider}\`` : ""}`
  try {
    const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: "Markdown" }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!r.ok) return { ok: false, error: `telegram HTTP ${r.status}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

async function fireGeneric(cfg: GenericConfig, ev: WebhookEvent): Promise<{ ok: boolean; error?: string }> {
  if (!shouldFireForKind(cfg.events, ev.kind)) return { ok: true }
  const body = JSON.stringify(ev)
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(cfg.headers ?? {}) }
  if (cfg.secret) {
    const sig = crypto.createHmac("sha256", cfg.secret).update(body).digest("hex")
    headers["X-Nexus-Signature"] = `sha256=${sig}`
  }
  try {
    const r = await fetch(cfg.url, {
      method: cfg.method ?? "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    })
    if (!r.ok) return { ok: false, error: `generic HTTP ${r.status}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ── Public API ──────────────────────────────────────────────────────

let rateLimits = new Map<string, number>()

function rateLimited(kind: WebhookEventKind, cooldownMs = 60_000): boolean {
  const now = Date.now()
  const last = rateLimits.get(kind) ?? 0
  if (now - last < cooldownMs) return true
  rateLimits.set(kind, now)
  return false
}

export interface SendResult {
  fired: number
  errors: { target: string; error: string }[]
}

/** Fire one event to all configured webhooks in parallel. */
export async function sendWebhook(event: Partial<WebhookEvent> & { kind: WebhookEventKind; message: string }): Promise<SendResult> {
  const cfg = loadConfig()
  const ev: WebhookEvent = {
    ts: new Date().toISOString(),
    level: levelFor(event.kind),
    ...event,
  }
  if (!shouldFire(cfg, ev)) return { fired: 0, errors: [] }
  if (rateLimited(ev.kind)) return { fired: 0, errors: [{ target: "*", error: "rate-limited" }] }

  const tasks: Promise<{ target: string; result: { ok: boolean; error?: string } }>[] = []
  if (cfg.slack) tasks.push(cfg.slack.url ? fireSlack(cfg.slack, ev).then((r) => ({ target: "slack", result: r })) : Promise.resolve({ target: "slack", result: { ok: true } }))
  if (cfg.discord) tasks.push(cfg.discord.url ? fireDiscord(cfg.discord, ev).then((r) => ({ target: "discord", result: r })) : Promise.resolve({ target: "discord", result: { ok: true } }))
  if (cfg.telegram) tasks.push(cfg.telegram.botToken ? fireTelegram(cfg.telegram, ev).then((r) => ({ target: "telegram", result: r })) : Promise.resolve({ target: "telegram", result: { ok: true } }))
  if (cfg.generic) {
    for (const g of cfg.generic) {
      tasks.push(fireGeneric(g, ev).then((r) => ({ target: g.url, result: r })))
    }
  }
  const results = await Promise.all(tasks)
  const errors = results.filter((r) => !r.result.ok).map((r) => ({ target: r.target, error: r.result.error ?? "?" }))
  if (errors.length) {
    log.warn("webhook", `${ev.kind} → ${results.length - errors.length}/${results.length} ok (${errors.length} errors)`)
  } else {
    log.debug("webhook", `${ev.kind} → ${results.length} targets ok`)
  }
  return { fired: results.length - errors.length, errors }
}

export const webhookManager = {
  load: loadConfig,
  save: saveConfig,
  getPath(): string { return CONFIG_PATH },
  send: sendWebhook,
  testAll: async (): Promise<{ target: string; ok: boolean; error?: string }[]> => {
    const cfg = loadConfig()
    const ev: WebhookEvent = {
      kind: "all",
      ts: new Date().toISOString(),
      message: "🧪 NEXUS webhook test",
      level: "info",
      data: { hostname: os.hostname(), platform: process.platform },
    }
    const out: { target: string; ok: boolean; error?: string }[] = []
    if (cfg.slack?.url) {
      const r = await fireSlack(cfg.slack, ev)
      out.push({ target: "slack", ...r })
    }
    if (cfg.discord?.url) {
      const r = await fireDiscord(cfg.discord, ev)
      out.push({ target: "discord", ...r })
    }
    if (cfg.telegram?.botToken) {
      const r = await fireTelegram(cfg.telegram, ev)
      out.push({ target: "telegram", ...r })
    }
    if (cfg.generic) {
      for (const g of cfg.generic) {
        const r = await fireGeneric(g, ev)
        out.push({ target: g.url, ...r })
      }
    }
    return out
  },
}
