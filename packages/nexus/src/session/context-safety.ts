import { redactInstructionText } from "./instruction"

export const MAX_CONTEXT_ENTRIES = 80
export const MAX_CONTEXT_ENTRY_CHARS = 16_000
export const MAX_CONTEXT_TOTAL_CHARS = 96_000

export type BoundedContext = {
  entries: string[]
  skippedEntries: number
  truncatedEntries: number
  redactedEntries: number
}

/** Pure, local-only model-input protection. It does not mutate or persist source messages. */
export function boundedRedactedContext(entries: readonly string[]): BoundedContext {
  const kept: string[] = []
  let remaining = MAX_CONTEXT_TOTAL_CHARS
  let skippedEntries = 0
  let truncatedEntries = 0
  let redactedEntries = 0

  for (const source of entries.slice(0, MAX_CONTEXT_ENTRIES)) {
    if (remaining <= 0) {
      skippedEntries++
      continue
    }
    const redacted = redactInstructionText(source)
    if (redacted !== source) redactedEntries++
    const limit = Math.min(MAX_CONTEXT_ENTRY_CHARS, remaining)
    const marker = "\n[context truncated]"
    if (redacted.length > limit && limit <= marker.length) {
      truncatedEntries++
      skippedEntries++
      continue
    }
    const value = redacted.length > limit ? `${redacted.slice(0, limit - marker.length)}${marker}` : redacted
    if (redacted.length > limit) truncatedEntries++
    kept.push(value)
    remaining -= value.length
  }
  skippedEntries += Math.max(0, entries.length - MAX_CONTEXT_ENTRIES)
  return { entries: kept, skippedEntries, truncatedEntries, redactedEntries }
}

export function contextSafetyNotice(input: BoundedContext): string | undefined {
  const notes = [
    input.redactedEntries > 0 ? `${input.redactedEntries} entry redacted` : undefined,
    input.truncatedEntries > 0 ? `${input.truncatedEntries} entry truncated` : undefined,
    input.skippedEntries > 0 ? `${input.skippedEntries} entry skipped` : undefined,
  ].filter(Boolean)
  return notes.length > 0 ? `[Context safety: ${notes.join(", ")}]` : undefined
}
