/**
 * Sensitive-data redaction for anything that may be displayed, stored, or
 * routed to the orchestrator/LLM. Applied by Voice Commander and available to
 * other plugins handling untrusted transcripts.
 */

const REDACTIONS: Array<[RegExp, string]> = [
  // One-time codes / recovery codes: 6-10 digit groups (with common separators)
  [/\b(?:\d[ -]?){6,10}\b/g, "[REDACTED-CODE]"],
  // API key shapes
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, "[REDACTED-KEY]"],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "[REDACTED-KEY]"],
  [/\bgsk_[A-Za-z0-9_-]{8,}/g, "[REDACTED-KEY]"],
  [/\bxai-[A-Za-z0-9_-]{8,}/g, "[REDACTED-KEY]"],
  [/\bAIza[0-Za-z0-9_-]{8,}/g, "[REDACTED-KEY]"],
  [/\bgh[pousr]_[A-Za-z0-9_]{8,}/g, "[REDACTED-TOKEN]"],
  [/\bxox[baprs]-[A-Za-z0-9_-]{8,}/g, "[REDACTED-TOKEN]"],
  [/Bearer\s+[A-Za-z0-9._-]{12,}/gi, "Bearer [REDACTED-TOKEN]"],
  // Explicit secrets: password/passphrase/token/secret/api key followed by a value
  [
    /((?:pass(?:word|wd|phrase)?|api[ _-]?key|token|secret|recovery[ _-]?code)\s*(?:is|:|=)?\s*")[^"]+"/gi,
    "$1[REDACTED]",
  ],
  [/((?:pass(?:word|wd|phrase)?|api[ _-]?key|token|secret|recovery[ _-]?code)\s*(?:is|:|=)?\s*)\S+/gi, "$1[REDACTED]"],
]

export function redactSensitive(text: string): string {
  return REDACTIONS.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), text)
}

export function containsSensitive(text: string): boolean {
  return redactSensitive(text) !== text
}

export * as Redact from "./redact"
