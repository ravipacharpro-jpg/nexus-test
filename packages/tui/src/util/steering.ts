/**
 * Local active-task steering: classifies a new user message while a task is
 * running and produces fixed, redacted acknowledgements. Classification is
 * purely deterministic (anchored phrase tables) and never consults a model,
 * a daemon, or any parallel execution path. Acknowledgement strings never
 * interpolate the incoming message text.
 */
export type SteeringKind = "status" | "stop" | "change" | "followup"

const STATUS_PHRASES = [
  "status",
  "status update",
  "progress",
  "progress update",
  "what's happening",
  "whats happening",
  "what is happening",
  "what are you doing",
  "what are u doing",
  "what's going on",
  "whats going on",
  "how's it going",
  "hows it going",
  "where are you",
  "kitna hua",
  "kya ho raha hai",
  "kya chal raha hai",
  "kya status hai",
]

const STOP_PHRASES = [
  "stop",
  "stop it",
  "stop now",
  "cancel",
  "cancel it",
  "cancel that",
  "cancel this",
  "cancel the task",
  "cancel task",
  "abort",
  "halt",
  "interrupt",
  "ruko",
  "ruk jao",
  "rukk jao",
  "band karo",
  "band kro",
  "chhodo",
  "chod do",
]

const CHANGE_PHRASES = [
  "instead",
  "actually",
  "wait no",
  "no wait",
  "change",
  "change that",
  "change this",
  "replan",
  "scratch that",
  "forget it",
  "forget that",
  "never mind",
  "nevermind",
  "start over",
  "redo",
  "badal do",
  "badal de",
  "nahi karo",
  "mat karo",
  "on second thought",
]

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s,.!?;:*\-]+/, "")
    .trim()
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Phrases only count at the start of the message so ordinary follow-ups that
// merely contain words like "stop" or "status" deeper in the text stay
// classified as follow-ups.
function leadingMatch(normalized: string, phrases: string[]) {
  return phrases.find((phrase) => new RegExp(`^${escapeRegExp(phrase)}(?=$|[\\s,.!?;:])`).test(normalized))
}

export function classifySteering(text: string): SteeringKind {
  const normalized = normalize(text)
  if (!normalized) return "followup"
  if (leadingMatch(normalized, STATUS_PHRASES)) return "status"
  if (leadingMatch(normalized, STOP_PHRASES)) return "stop"
  if (leadingMatch(normalized, CHANGE_PHRASES)) return "change"
  return "followup"
}

/**
 * Removes the leading stop/cancel phrase so any remaining content can be
 * preserved as the next prompt after an explicit cancellation. Returns an
 * empty string when the message was only a stop request.
 *
 * The longest valid leading stop phrase always wins, so overlapping entries
 * ("stop" vs "stop now", "cancel the task") can never leave a phantom
 * remainder like "now". Only one phrase is stripped: the remaining text is
 * preserved verbatim, even when it starts with a word like "stop".
 */
export function stripStopPhrase(text: string): string {
  const trimmed = text.trim()
  let best: string | undefined
  for (const phrase of STOP_PHRASES) {
    const match = trimmed.match(new RegExp(`^${escapeRegExp(phrase)}(?=$|[\\s,.!?;:])`, "i"))
    if (match && (!best || match[0].length > best.length)) best = match[0]
  }
  if (!best) return trimmed
  return trimmed
    .slice(best.length)
    .replace(/^[\s,.!?;:]+/, "")
    .trim()
}

/** Fixed acknowledgements. These strings are constants and must never embed user input. */
export const STEERING_ACK = {
  stop: "Stopping current task…",
  change: "Change requested — awaiting your choice.",
  followup: "Queued until the active task finishes.",
} satisfies Record<Exclude<SteeringKind, "status">, string>

/**
 * Builds the fixed local status answer from an existing redacted activity
 * category only (see activity.ts). Falls back to the same neutral stage the
 * timeline uses, so no raw prompt/path/tool text can ever appear here.
 */
export function steeringStatusLine(activity: string | undefined): string {
  return `Status: ${activity ?? "Thinking..."}`
}
