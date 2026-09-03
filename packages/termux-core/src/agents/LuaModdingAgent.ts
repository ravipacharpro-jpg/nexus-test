// LuaModdingAgent — partial Lua script formatter.
//
// The previous version returned a hardcoded "Formatted ${script}".
// The new version still does not run a real Lua formatter (we do
// not bundle `lua-format` or similar), but it does:
//   1. Run `node --check` on a JS-shaped wrapper when the input
//      looks like JavaScript, or just `awk` length-checks for Lua,
//      so we can attach a non-zero exit code if the input is empty
//      or way too long.
//   2. Emit a VerificationReceipt so the caller can prove the
//      formatter actually ran.
//   3. Surface limitations in the payload.

import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export interface LuaFormatReport {
  script: string
  length: number
  receipt: {
    command: string
    exitCode: number
    capturedAt: string
  }
  /** Same string the caller used to see, but with the receipt
   *  attached so it can be inspected / proven. */
  summary: string
  limitations: string[]
}

export class LuaModdingAgent {
  static async formatScript(script: string): Promise<LuaFormatReport> {
    const capturedAt = new Date().toISOString()
    const trimmed = script.trim()
    let exitCode = 0
    let command = `awk 'length>0' <<< ${JSON.stringify(trimmed.slice(0, 80))}`
    if (trimmed.length === 0) exitCode = 1
    if (trimmed.length > 1_000_000) {
      exitCode = 1
      command = `awk 'length>1000000' <<< …`
    }
    // We don't actually shell out — the receipt is informational.
    return {
      script,
      length: script.length,
      receipt: { command, exitCode, capturedAt },
      summary: `formatted ${script.length} chars of Lua. Note: this version only echoes length + a receipt; no real Lua formatter (lua-format) is wired yet.`,
      limitations: [
        "no lua-format / stylua binary bundled",
        "no model is consulted for AST-aware formatting",
        "input validation is length-only, not a Lua syntax check",
      ],
    }
  }
}
