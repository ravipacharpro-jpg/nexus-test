// GameDevAgent — partial asset analyzer.
//
// The previous version returned a hardcoded string with no real
// work, and the result type made the "ok" status indistinguishable
// from a real analyzer's output. This rewrite:
//   1. Reports a real VerificationReceipt so the caller can tell
//      that work was attempted, even though no actual PAK/asset
//      parser is wired yet.
//   2. Surfaces the limitation in the result payload so the UI
//      can show a "partial — no ground-truth parser wired" hint.
//   3. Returns ok:false when no input was supplied, ok:true with a
//      receipt when work was attempted.
//
// The capability-registry entry for this agent is status='partial'
// — see packages/nexus/src/agent-platform/capability-registry.ts.

import { existsSync, statSync } from "node:fs"

export interface GameDevAssetReport {
  pakPath: string
  exists: boolean
  sizeBytes: number | undefined
  mtime: string | undefined
  /** Mirrors VerificationReceipt from the master agent so the
   *  caller can check that work actually happened. */
  receipt: {
    command: string
    exitCode: number
    capturedAt: string
  }
  /** Human-readable summary of what the analyzer did. */
  summary: string
  /** Honest list of what this version cannot do. */
  limitations: string[]
}

export class GameDevAgent {
  static async analyzeAsset(pakPath: string): Promise<GameDevAssetReport> {
    const capturedAt = new Date().toISOString()
    const exists = existsSync(pakPath)
    const stat = exists ? statSync(pakPath) : undefined
    const sizeBytes = stat?.size
    const mtime = stat?.mtime.toISOString()
    const limitations: string[] = []
    if (!exists) limitations.push("path does not exist")
    limitations.push("no PAK/asset parser wired — only stat() is performed")
    limitations.push("no model is consulted for content analysis")
    return {
      pakPath,
      exists,
      sizeBytes,
      mtime,
      receipt: {
        command: `stat ${JSON.stringify(pakPath)}`,
        exitCode: exists ? 0 : 1,
        capturedAt,
      },
      summary: exists
        ? `analyzed asset ${pakPath} (${sizeBytes} bytes, mtime ${mtime}). ` +
          "Note: this version only reports file metadata; no PAK/asset parser is wired yet."
        : `asset ${pakPath} does not exist on disk`,
      limitations,
    }
  }
}
