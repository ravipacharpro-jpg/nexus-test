// design-tokens loader: a tiny shared utility that generators
// (BotAgent, ToolAgent, future UI agents) call before emitting
// any code. Returns the parsed tokens, or throws if the
// reference spec is missing a required key.
//
// Why: the NEXUS_QUALITY_CHECKLIST.md "Reference-spec grounding"
// item asks every code-/UI-generating agent to read docs/design-tokens.md
// before producing output. This is the single concrete entry
// point they all share, so the convention is enforced once at
// the source and reused everywhere.
//
// Cross-platform: pure node:fs + node:path. No deps. Works on
// Termux, Linux, macOS, Windows.

import { existsSync, readFileSync } from "node:fs"
import { join, isAbsolute, resolve } from "node:path"

const DEFAULT_PATH = "docs/design-tokens.md"

/** The parsed design tokens. We only need a few fields, not
 *  the full markdown structure, so we extract them with a couple
 *  of well-known grep patterns. */
export interface DesignTokens {
  /** Path of the spec that was loaded. */
  sourcePath: string
  /** True if the file existed and contained all required sections. */
  valid: boolean
  /** Free-form raw markdown so agents can render / cite it if needed. */
  raw: string
  /** Detected color hex values from the spec (for ad-hoc validation). */
  colors: Record<string, string>
  /** Missing sections (empty when valid). */
  missing: string[]
}

const REQUIRED_SECTIONS = [
  "## 1. Color tokens",
  "## 2. Log format",
  "## 3. Command / slash-name convention",
  "## 4. File-output contract",
  "## 5. Lua / config / JSON conventions",
  "## 6. Error-message convention",
] as const

const COLOR_REGEX = /`--([a-z0-9-]+)`\s*\|\s*`#([0-9A-Fa-f]{3,8})`/g

/** Load the design-tokens spec. Throws on missing required section. */
export function loadDesignTokens(pathHint?: string): DesignTokens {
  const fp = resolve(pathHint ?? (isAbsolute(DEFAULT_PATH) ? DEFAULT_PATH : join(process.cwd(), DEFAULT_PATH)))
  if (!existsSync(fp)) {
    return { sourcePath: fp, valid: false, raw: "", colors: {}, missing: [...REQUIRED_SECTIONS] }
  }
  const raw = readFileSync(fp, "utf8")
  const missing = REQUIRED_SECTIONS.filter((s) => !raw.includes(s))
  const colors: Record<string, string> = {}
  for (const m of raw.matchAll(COLOR_REGEX)) {
    colors[m[1]!] = `#${m[2]!}`
  }
  return { sourcePath: fp, valid: missing.length === 0, raw, colors, missing }
}

/** Throw if the spec is missing. Use at the top of every
 *  generator's execute() method. */
export function requireDesignTokens(pathHint?: string): DesignTokens {
  const t = loadDesignTokens(pathHint)
  if (!t.valid) {
    const miss = t.missing.join(", ")
    throw new Error(
      `design-tokens spec incomplete at ${t.sourcePath} — missing: ${miss}. ` +
        `Fix the spec or remove this call. (See NEXUS_QUALITY_CHECKLIST.md 'Reference-spec grounding'.)`,
    )
  }
  return t
}
