// recovery-narrator: when a tool call fails, narrate the diagnosis +
// retry loop so the user sees progress instead of a wall of error text.
// ASCII-only, no emoji.

export interface FailureContext {
  tool: string
  args: Record<string, unknown>
  error: string
  attempt: number
  maxAttempts: number
}

export interface RecoveryDecision {
  /** What to do next. */
  action: "retry" | "retry-with-fix" | "different-tool" | "ask-user" | "abort"
  /** Human-readable one-liner. */
  text: string
  /** Optional fix to apply on retry. */
  fix?: { argKey: string; argValue: unknown }
}

const ICON_FAIL = "[x]"
const ICON_RETRY = "[~]"
const ICON_OK = "[+]"

/** Heuristic classifier: what kind of error is this? */
export function classifyError(err: string): {
  kind: "transient" | "permission" | "syntax" | "logic" | "not-found" | "rate-limit" | "unknown"
  hint: string
} {
  const e = err.toLowerCase()
  if (/etimedout|econnrefused|epipe|network|503|502|504|timeout|temporarily unavailable/.test(e))
    return { kind: "transient", hint: "transient network/server error" }
  if (/eacces|permission denied|forbidden|401|403/.test(e))
    return { kind: "permission", hint: "permission denied" }
  if (/syntax|unexpected token|parse error|invalid syntax/.test(e))
    return { kind: "syntax", hint: "syntax error" }
  if (/429|rate limit|too many requests/.test(e))
    return { kind: "rate-limit", hint: "rate limited" }
  if (/enoent|no such file|not found|404/.test(e))
    return { kind: "not-found", hint: "resource not found" }
  if (/typeerror|referenceerror|null|cannot read|undefined/.test(e))
    return { kind: "logic", hint: "logic error" }
  return { kind: "unknown", hint: "unknown error" }
}

/** Decide what to do for a given failure. */
export function decide(ctx: FailureContext): RecoveryDecision {
  const cls = classifyError(ctx.error)
  const remaining = ctx.maxAttempts - ctx.attempt
  // Transient: always retry up to 3 times with backoff
  if (cls.kind === "transient" && remaining > 0) {
    return { action: "retry", text: `transient (${cls.hint}) — retrying (${remaining} left)` }
  }
  // Rate limit: ask user to back off or use alt provider
  if (cls.kind === "rate-limit" && remaining > 0) {
    return {
      action: "retry-with-fix",
      text: `rate limited — backing off`,
      fix: { argKey: "delayMs", argValue: 30_000 },
    }
  }
  // Syntax: try once more after minor fix (strip CR, etc.)
  if (cls.kind === "syntax" && remaining > 0) {
    return {
      action: "retry-with-fix",
      text: `syntax error — re-parsing with relaxed mode`,
      fix: { argKey: "strict", argValue: false },
    }
  }
  // Permission: ask user (can't auto-fix)
  if (cls.kind === "permission") {
    return { action: "ask-user", text: `${ICON_FAIL} ${cls.hint} — needs user authorization` }
  }
  // Not-found: try a fallback path
  if (cls.kind === "not-found" && remaining > 0) {
    return { action: "different-tool", text: `not found — trying alternative` }
  }
  // Logic / unknown: give up after max attempts
  if (remaining <= 0) {
    return { action: "abort", text: `${ICON_FAIL} ${cls.hint} — out of retries` }
  }
  return { action: "retry", text: `${cls.hint} — retrying` }
}

/** Format a failure + recovery as a short ASCII trace. */
export function formatFailure(ctx: FailureContext, decision: RecoveryDecision): string {
  const lines: string[] = []
  lines.push(`${ICON_FAIL} ${ctx.tool} failed (attempt ${ctx.attempt}/${ctx.maxAttempts}): ${ctx.error.slice(0, 120)}`)
  lines.push(`  -> ${decision.text}`)
  if (decision.fix) {
    lines.push(`  -> applying fix: ${decision.fix.argKey} = ${JSON.stringify(decision.fix.argValue)}`)
  }
  return lines.join("\n")
}

/** Format a success line. */
export function formatRecovered(tool: string, attempt: number, ms: number): string {
  return `${ICON_OK} ${tool} recovered on attempt ${attempt} (${(ms / 1000).toFixed(1)}s)`
}

/** Top-level: run a tool call with automatic narration. */
export async function withRecovery<T>(
  tool: string,
  args: Record<string, unknown>,
  runner: (a: Record<string, unknown>) => Promise<T>,
  opts: { maxAttempts?: number; onFailure?: (ctx: FailureContext, d: RecoveryDecision) => void } = {},
): Promise<T> {
  const max = opts.maxAttempts ?? 3
  let attempt = 1
  let lastErr: Error | null = null
  while (attempt <= max) {
    const t0 = Date.now()
    try {
      const out = await runner(args)
      return out
    } catch (e) {
      lastErr = e as Error
      const ctx: FailureContext = {
        tool,
        args,
        error: lastErr.message,
        attempt,
        maxAttempts: max,
      }
      const d = decide(ctx)
      if (opts.onFailure) opts.onFailure(ctx, d)
      if (d.action === "abort" || d.action === "ask-user") throw e
      if (d.fix) args = { ...args, [d.fix.argKey]: d.fix.argValue }
      const backoff = attempt * 1000
      await new Promise((r) => setTimeout(r, backoff))
      attempt++
    }
  }
  throw lastErr ?? new Error(`${tool} failed after ${max} attempts`)
}
