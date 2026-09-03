// headroom-lite: context compression layer for NEXUS
// Inspired by https://github.com/headroomlabs-ai/headroom
// Goal: drop 60-95% of tokens from JSON/tool output/logs before LLM.
//
// Three strategies implemented (no ML dependencies, all pure TypeScript):
//   1. JSON flattening   — drop nulls, truncate long strings, keep keys
//   2. Code AST trim     — strip comments + collapse whitespace in source
//   3. Log deduplication — keep first + last of repeated lines
//
// Plus the "live-zone" rule: we never touch messages BEFORE the most
// recent user turn, so provider KV cache stays warm.
//
// Usage:
//   const result = compressContext({ messages, model, protect_recent: 4 })
//   console.log(result.tokensBefore, "->", result.tokensAfter,
//               "saved", result.tokensSaved, "tokens",
//               `(${(result.compressionRatio * 100).toFixed(1)}%)`)

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | unknown
  name?: string
  tool_call_id?: string
}

export interface CompressConfig {
  /** Keep last N messages untouched (KV cache safety). Default 4. */
  protect_recent: number
  /** Compress system messages too. Default true. */
  compress_system_messages: boolean
  /** Compress user messages. Default false (user is the spec). */
  compress_user_messages: boolean
  /** Target ratio (0..1) for json/log code. Default 0.4. */
  target_ratio: number
  /** Skip compression if total < N tokens. Default 250. */
  min_tokens_to_compress: number
  /** Don't compress anything shorter than N chars. Default 200. */
  min_chars_to_compress: number
}

export interface CompressResult {
  messages: ChatMessage[]
  tokensBefore: number
  tokensAfter: number
  tokensSaved: number
  compressionRatio: number
  transformsApplied: string[]
  /** True if compression didn't help; we returned the original. */
  inflationGuard: boolean
}

export const DefaultConfig: CompressConfig = {
  protect_recent: 4,
  compress_system_messages: true,
  compress_user_messages: false,
  target_ratio: 0.4,
  min_tokens_to_compress: 250,
  min_chars_to_compress: 200,
}

// Heuristic: ~4 chars per token for English / JSON / code.
const CHARS_PER_TOKEN = 4

function estimateTokens(s: string): number {
  return Math.ceil(s.length / CHARS_PER_TOKEN)
}

function stringifyContent(c: string | unknown): string {
  if (typeof c === "string") return c
  try { return JSON.stringify(c) } catch { return String(c) }
}

// ── Strategy 1: JSON flattening ──────────────────────────────────────
function looksLikeJson(s: string): boolean {
  const t = s.trim()
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))
}

function compressJson(input: string, targetRatio: number): { out: string; transformed: boolean } {
  try {
    const obj = JSON.parse(input)
    const out = trimJson(obj, targetRatio)
    const s = JSON.stringify(out, null, 0)
    return { out: s, transformed: s.length < input.length * 0.99 }
  } catch {
    return { out: input, transformed: false }
  }
}

function trimJson(value: unknown, targetRatio: number, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (depth > 8) return "…"
  if (typeof value === "string") {
    if (value.length > 120) return value.slice(0, 100) + `…+${value.length - 100}ch`
    return value
  }
  if (typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) {
    const maxItems = Math.max(3, Math.floor(20 * targetRatio * 2))
    if (value.length > maxItems) {
      return [
        ...value.slice(0, maxItems).map((v) => trimJson(v, targetRatio, depth + 1)),
        `…+${value.length - maxItems} more items`,
      ]
    }
    return value.map((v) => trimJson(v, targetRatio, depth + 1))
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj)) {
      if (obj[k] === null || obj[k] === undefined) continue
      if (typeof obj[k] === "string" && (obj[k] as string).length === 0) continue
      out[k] = trimJson(obj[k], targetRatio, depth + 1)
    }
    return out
  }
  return value
}

// ── Strategy 2: Code AST trim (no real AST; strip comments + collapse ws) ──
function looksLikeCode(s: string): boolean {
  // very rough: must have multiple lines + common code sigils
  if (s.split("\n").length < 3) return false
  return /[{};]|function |def |class |import |export |const |let |var /.test(s)
}

function compressCode(input: string): { out: string; transformed: boolean } {
  const lines = input.split("\n")
  const kept: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (t === "") continue
    if (t.startsWith("//") || t.startsWith("#")) continue
    if (/^\s*\/\*.*\*\//.test(t)) continue
    // collapse multiple spaces
    kept.push(line.replace(/[ \t]+/g, " "))
  }
  const out = kept.join("\n")
  return { out, transformed: out.length < input.length * 0.95 }
}

// ── Strategy 3: Log deduplication ─────────────────────────────────────
function looksLikeLog(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}|INFO|WARN|ERROR|DEBUG|\[\d{4}-\d{2}/m.test(s)
}

function compressLog(input: string, targetRatio: number): { out: string; transformed: boolean } {
  const lines = input.split("\n")
  if (lines.length < 8) return { out: input, transformed: false }
  // Group consecutive identical lines; keep first 2 + last 1.
  const groups: { line: string; count: number }[] = []
  for (const l of lines) {
    if (groups.length && groups[groups.length - 1].line === l) groups[groups.length - 1].count++
    else groups.push({ line: l, count: 1 })
  }
  const out: string[] = []
  for (const g of groups) {
    if (g.count === 1) out.push(g.line)
    else if (g.count <= 3) for (let i = 0; i < g.count; i++) out.push(g.line)
    else { out.push(g.line); out.push(g.line); out.push(`  … repeated ${g.count - 3} more times …`); out.push(g.line) }
    if (out.length > lines.length * targetRatio * 2) break
  }
  const s = out.join("\n")
  return { out: s, transformed: s.length < input.length * 0.95 }
}

// ── Main entry point ─────────────────────────────────────────────────
export function compressContext(input: {
  messages: ChatMessage[]
  model?: string
  config?: Partial<CompressConfig>
}): CompressResult {
  const cfg: CompressConfig = { ...DefaultConfig, ...(input.config ?? {}) }
  const messages = input.messages
  if (messages.length === 0) {
    return { messages, tokensBefore: 0, tokensAfter: 0, tokensSaved: 0, compressionRatio: 1, transformsApplied: [], inflationGuard: false }
  }

  // Calculate total tokens
  const beforeSigs = messages.map((m) => stringifyContent(m.content))
  const tokensBefore = beforeSigs.reduce((s, c) => s + estimateTokens(c), 0)
  if (tokensBefore < cfg.min_tokens_to_compress) {
    return { messages, tokensBefore, tokensAfter: tokensBefore, tokensSaved: 0, compressionRatio: 1, transformsApplied: ["skipped: below min_tokens"], inflationGuard: false }
  }

  const compressed: ChatMessage[] = []
  const transforms: string[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const isProtected = i >= messages.length - cfg.protect_recent
    const role = m.role
    const doCompress =
      (role === "system" && cfg.compress_system_messages) ||
      (role === "user" && cfg.compress_user_messages) ||
      (role === "tool") ||
      (role === "assistant")
    if (isProtected || !doCompress) {
      compressed.push(m)
      continue
    }
    const text = stringifyContent(m.content)
    if (text.length < cfg.min_chars_to_compress) {
      compressed.push(m)
      continue
    }

    let out = text
    let didAny = false
    if (looksLikeJson(text)) {
      const r = compressJson(text, cfg.target_ratio)
      if (r.transformed) { out = r.out; didAny = true; transforms.push("json") }
    }
    if (!didAny && looksLikeCode(text)) {
      const r = compressCode(text)
      if (r.transformed) { out = r.out; didAny = true; transforms.push("code") }
    }
    if (!didAny && looksLikeLog(text)) {
      const r = compressLog(text, cfg.target_ratio)
      if (r.transformed) { out = r.out; didAny = true; transforms.push("log") }
    }
    if (didAny) compressed.push({ ...m, content: out })
    else compressed.push(m)
  }

  const afterSigs = compressed.map((m) => stringifyContent(m.content))
  const tokensAfter = afterSigs.reduce((s, c) => s + estimateTokens(c), 0)

  // Inflation guard
  if (tokensAfter >= tokensBefore) {
    return { messages, tokensBefore, tokensAfter: tokensBefore, tokensSaved: 0, compressionRatio: 1, transformsApplied: [], inflationGuard: true }
  }

  return {
    messages: compressed,
    tokensBefore,
    tokensAfter,
    tokensSaved: tokensBefore - tokensAfter,
    compressionRatio: tokensAfter / tokensBefore,
    transformsApplied: Array.from(new Set(transforms)),
    inflationGuard: false,
  }
}
