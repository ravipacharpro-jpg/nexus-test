// short-reply-mode: detect one-line user inputs ("haan", "ok", "stop",
// "?", "status") and respond instantly WITHOUT spinning up the full
// agent / API round-trip. The user gets a sub-100ms answer; the long
// background task is briefly paused so the response is uncontested.
//
// What counts as "short"?
//   - length <= 24 chars
//   - no sentence terminator (., !, ? followed by space + capital)
//   - matches one of the patterns below, OR is a known command alias
//
// Patterns (case-insensitive, allow trailing punctuation):
//   yes / no / haan / han / okay / ok / sure / thik / sahi
//   ? / help / kya / kya hua / kya kar rahe
//   stop / cancel / pause / wait / ruko / band
//   resume / continue / agle / next / chal
//   status / progress / kahan / kitna
//   thanks / shukriya / bye / alvida
//   <number>                 → "select option N"

import { emit, throttled } from "./priority-router.ts"

export type ShortIntent =
  | "affirm" | "deny" | "help" | "status"
  | "stop" | "resume" | "next" | "thanks" | "select" | "unknown"

export interface ShortReply {
  intent: ShortIntent
  /** Pre-canned reply (no LLM needed). */
  reply: string
  /** Optional structured payload (e.g. select index). */
  data?: Record<string, unknown>
}

const REPLIES: Record<ShortIntent, string> = {
  affirm: "[+] noted",
  deny: "[-] ok, skipped",
  help: "[i] commands: stop | status | resume | next | <number>",
  status: "[..] checking... (one moment)",
  stop: "[!] pausing current task",
  resume: "[>] resuming...",
  next: "[>>] moving to next step",
  thanks: "[+] you're welcome",
  select: "[#] selected",
  unknown: "...", // will fall through to the slow path
}

const AFFIRM = /^(y|yes|yeah|yep|ok|okay|haan|han|ha|sahi|thik|sure|definitely|absolutely|ji|achha|accha|thik hai|kar do|kardo)\b/i
const DENY   = /^(n|no|nah|nope|na|nahi|mat|cancel karo|mat karo|rehne do|skip)\b/i
const HELP   = /^(\?|help|help me|kya|kya hua|kya kar|kaise|madad|commands|menu)\b/i
const STOP   = /^(stop|cancel|pause|wait|ruko|ruk|band|exit|quit|kill|bass|bahut)\b/i
const RESUME = /^(resume|continue|agle|next|chal|chalo|phir|restart|go on|aage badh)\b/i
const STATUS = /^(status|progress|kahan|kitna|kahan tak|how far|update|kya chal raha|what's up)\b/i
const THANKS = /^(thanks|thank you|shukriya|thx|ty|dhanyavad|bye|alvida|ta-ta|gn)\b/i

export function classifyShort(text: string): ShortIntent {
  const t = text.trim()
  if (t.length === 0 || t.length > 24) return "unknown"
  if (STOP.test(t)) return "stop"
  if (RESUME.test(t)) return "resume"
  // "next" is ambiguous — could be a queue command or an affirmative.
  // We treat it as "next" (more specific) when it stands alone.
  if (t.toLowerCase() === "next" || /^next\b/.test(t)) return "next"
  if (HELP.test(t)) return "help"
  if (STATUS.test(t)) return "status"
  if (THANKS.test(t)) return "thanks"
  if (AFFIRM.test(t)) return "affirm"
  if (DENY.test(t)) return "deny"
  // Pure number → "select N"
  if (/^\d{1,3}$/.test(t)) return "select"
  return "unknown"
}

export function buildShortReply(text: string): ShortReply {
  const intent = classifyShort(text)
  const reply = REPLIES[intent]
  if (intent === "select") {
    return { intent, reply: `${reply} option ${text.trim()}`, data: { index: Number(text.trim()) } }
  }
  return { intent, reply }
}

/** Top-level entry point. Returns the reply if it was a short message,
 *  or null if the message is "long" and should go to the full agent. */
export function tryShortReply(text: string): ShortReply | null {
  const t = text.trim()
  if (t.length === 0 || t.length > 24) return null
  if (t.includes("\n")) return null
  // Don't handle if it looks like a sentence (has multiple words ending with punctuation)
  if (/[.!?]\s+[A-Z]/.test(t)) return null
  const intent = classifyShort(t)
  if (intent === "unknown") return null
  // Dedupe: don't spam the same short reply twice in 1s
  if (throttled("short:" + intent, 1000)) return { intent, reply: REPLIES[intent] }
  return buildShortReply(t)
}

/** Convenience for the TUI: emit a short reply as a user-bucket message. */
export function replyShort(text: string): ShortReply | null {
  const r = tryShortReply(text)
  if (r) emit(80, "short-reply", r.reply, { intent: r.intent, ...(r.data ?? {}) })
  return r
}

/** Sanity check: ensure REPLIES contain no emoji. */
function _emojiCheck() {
  const emojiRe = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{27BF}]/u
  for (const [k, v] of Object.entries(REPLIES)) {
    if (emojiRe.test(v)) throw new Error(`REPLIES[${k}] contains emoji: ${v}`)
  }
}
_emojiCheck()
