// marketplace: a small manifest format for shareable NEXUS
// agents / skills / commands. Inspired by davila7/claude-code-templates
// (30k stars) — they organize 100+ community agents as JSON
// manifests installable via 'npx ... --agent <id>'. We use the
// same pattern at a much smaller scale: a single JSON file per
// entry under ~/.nexus/marketplace/ that the autofarm master
// can list, install, and remove.
//
// Cross-platform: pure node:fs + node:path. No deps. Works on
// Termux, Linux, macOS, Windows.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const MARKETPLACE_DIR = path.join(os.homedir(), ".nexus", "marketplace")
const INSTALLED_DIR = path.join(os.homedir(), ".nexus", "marketplace", "installed")

export interface MarketplaceEntry {
  id: string
  name: string
  version: string
  author: string
  description: string
  category: "agent" | "skill" | "command" | "mcp"
  tags: string[]
  /** Inline source for the entry. For agents this is a
   *  TypeScript source string the autofarm can drop into
   *  packages/termux-core/src/agents/. For skills it is
   *  markdown. The marketplace never executes the source; the
   *  user reviews and confirms before install. */
  source: string
  /** Optional dependency hints. The autofarm installer
   *  surfaces them in the install summary. */
  requires?: string[]
  /** ISO date. */
  addedAt: string
}

export function ensureMarketplaceDirs(): void {
  fs.mkdirSync(MARKETPLACE_DIR, { recursive: true })
  fs.mkdirSync(INSTALLED_DIR, { recursive: true })
}

/** List every marketplace entry on disk, sorted by id. */
export function listMarketplace(): MarketplaceEntry[] {
  ensureMarketplaceDirs()
  const out: MarketplaceEntry[] = []
  for (const f of fs.readdirSync(MARKETPLACE_DIR)) {
    if (!f.endsWith(".json")) continue
    if (f === "installed") continue
    try {
      const text = fs.readFileSync(path.join(MARKETPLACE_DIR, f), "utf8")
      const entry = JSON.parse(text) as MarketplaceEntry
      if (entry.id && entry.name && entry.source) out.push(entry)
    } catch {
      // skip malformed
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

/** Read a single entry by id. */
export function getEntry(id: string): MarketplaceEntry | undefined {
  return listMarketplace().find((e) => e.id === id)
}

/** Save (overwrite) a marketplace entry. Used by `marketplace
 *  install` when the user is adding their own agents, and by
 *  future 'pull from a gist' flows. */
export function putEntry(entry: MarketplaceEntry): void {
  ensureMarketplaceDirs()
  fs.writeFileSync(path.join(MARKETPLACE_DIR, `${entry.id}.json`), JSON.stringify(entry, null, 2) + "\n")
}

/** Record a successful install. The 'installed/' folder keeps
 *  a snapshot so the user can `marketplace remove` later. */
export function markInstalled(id: string, entry: MarketplaceEntry): void {
  ensureMarketplaceDirs()
  const installedFile = path.join(INSTALLED_DIR, `${id}.json`)
  fs.writeFileSync(installedFile, JSON.stringify({ ...entry, installedAt: new Date().toISOString() }, null, 2) + "\n")
}

export function listInstalled(): MarketplaceEntry[] {
  ensureMarketplaceDirs()
  const out: MarketplaceEntry[] = []
  for (const f of fs.readdirSync(INSTALLED_DIR)) {
    if (!f.endsWith(".json")) continue
    try {
      const text = fs.readFileSync(path.join(INSTALLED_DIR, f), "utf8")
      const entry = JSON.parse(text) as MarketplaceEntry
      if (entry.id) out.push(entry)
    } catch {
      // skip
    }
  }
  return out
}

/** Format the catalogue as a one-line-per-entry table. */
export function formatMarketplaceTable(entries: MarketplaceEntry[]): string {
  if (entries.length === 0) return "Marketplace: empty. Add entries to ~/.nexus/marketplace/<id>.json"
  const lines = ["Marketplace:"]
  for (const e of entries) {
    lines.push(`  ${e.id.padEnd(28)} ${e.category.padEnd(8)} ${e.name}  v${e.version}  (${e.author})`)
  }
  return lines.join("\n")
}
