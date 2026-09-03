// nexus-memory: persistent cross-session state.
//
// User pain point: 'ma har session me scratch se start karta hoon'.
// Every fresh NEXUS session booted with zero context — the model
// had to re-derive the user's vault shape, preferred free models,
// and recent tasks from scratch. The /health command rebuilt
// the snapshot every time the user asked.
//
// This module writes a small JSON snapshot to
// ~/.nexus/memory.json after every relevant event and reloads
// it on next boot. The schema is intentionally tiny so it
// survives upgrades, free-tier quota churns, and cross-device
// sync (the cross-platform sync Gist target from a previous
// commit already covers upload of any file under ~/.nexus).
//
// Cross-platform: pure node:fs, no native deps. Works on
// Termux, Linux, macOS, Windows.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const MEMORY_PATH = path.join(os.homedir(), ".nexus", "memory.json")

export interface NexusMemory {
  version: 1
  updatedAt: string
  /** Free-form key/value preferences the user has set or the
   *  agent has learned (e.g. { "defaultProvider": "openrouter" }). */
  preferences: Record<string, string>
  /** Last 20 tasks the user ran, with one-line summaries. */
  recentTasks: Array<{ ts: string; summary: string }>
  /** Cache of the last /health snapshot so the next session
   *  can show 'last known health' without re-running all checks. */
  lastHealth?: { generatedAt: string; status: "ok" | "warn" | "fail" }
  /** Per-key rotation cursor — survives restarts so we don't
   *  reset to key 0 every boot. */
  rotationCursor?: number
}

function emptyMemory(): NexusMemory {
  return { version: 1, updatedAt: new Date().toISOString(), preferences: {}, recentTasks: [] }
}

export function loadMemory(): NexusMemory {
  try {
    if (!fs.existsSync(MEMORY_PATH)) return emptyMemory()
    const j = JSON.parse(fs.readFileSync(MEMORY_PATH, "utf8")) as NexusMemory
    if (j.version !== 1) return emptyMemory()
    return j
  } catch {
    return emptyMemory()
  }
}

export function saveMemory(m: NexusMemory): void {
  try {
    fs.mkdirSync(path.dirname(MEMORY_PATH), { recursive: true })
    const out: NexusMemory = { ...m, updatedAt: new Date().toISOString() }
    fs.writeFileSync(MEMORY_PATH, JSON.stringify(out, null, 2) + "\n")
  } catch {
    // best-effort
  }
}

export function setPreference(key: string, value: string): NexusMemory {
  const m = loadMemory()
  m.preferences[key] = value
  saveMemory(m)
  return m
}

export function recordTask(summary: string, keep = 20): NexusMemory {
  const m = loadMemory()
  m.recentTasks = [{ ts: new Date().toISOString(), summary }, ...m.recentTasks].slice(0, keep)
  saveMemory(m)
  return m
}

export function recordHealth(status: "ok" | "warn" | "fail"): NexusMemory {
  const m = loadMemory()
  m.lastHealth = { generatedAt: new Date().toISOString(), status }
  saveMemory(m)
  return m
}

export function setRotationCursor(cursor: number): NexusMemory {
  const m = loadMemory()
  m.rotationCursor = cursor
  saveMemory(m)
  return m
}

export function formatMemoryReport(m: NexusMemory): string {
  const lines: string[] = []
  lines.push(`Nexus memory — ${m.updatedAt}`)
  const prefKeys = Object.keys(m.preferences)
  lines.push(`  preferences: ${prefKeys.length === 0 ? "(none)" : prefKeys.length + " key(s)"}`)
  for (const [k, v] of Object.entries(m.preferences).slice(0, 5)) {
    lines.push(`    ${k} = ${v}`)
  }
  lines.push(`  recent tasks: ${m.recentTasks.length}`)
  for (const t of m.recentTasks.slice(0, 5)) {
    lines.push(`    [${t.ts.slice(11, 19)}] ${t.summary}`)
  }
  if (m.lastHealth) lines.push(`  last health: ${m.lastHealth.status} at ${m.lastHealth.generatedAt}`)
  if (m.rotationCursor !== undefined) lines.push(`  rotation cursor: ${m.rotationCursor}`)
  return lines.join("\n")
}
