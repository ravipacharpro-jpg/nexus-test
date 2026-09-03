// claude-mem-lite: persistent cross-session memory for NEXUS autofarm
// Inspired by https://github.com/thedotmack/claude-mem
//
// Pure-TS implementation (no native deps) using JSONL storage.
// Path: ~/.nexus/autofarm/memory/{sessions,observations}.jsonl
//
// 3-layer search:
//   1. search()         — compact index, ~50-100 tokens per result
//   2. timeline()       — chronological window around anchor
//   3. getObservations()— full hydrate by IDs
//
// All local; no network; works fully offline on Termux.

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { log } from "./logger.ts"

const MEMORY_DIR = path.join(os.homedir(), ".nexus", "autofarm", "memory")
const SESSIONS_FILE = path.join(MEMORY_DIR, "sessions.jsonl")
const OBS_FILE = path.join(MEMORY_DIR, "observations.jsonl")

export type Project = "autofarm" | "all"
export type ObsType = "bugfix" | "feature" | "refactor" | "test" | "docs" | "chore" | "discovery"

export interface SessionRow {
  id: number
  content_session_id: string
  memory_session_id: string
  project: string
  user_prompt: string | null
  started_at: string
  started_at_epoch: number
  completed_at: string | null
  completed_at_epoch: number | null
  status: "active" | "completed" | "failed"
}

export interface ObservationRow {
  id: number
  memory_session_id: string
  project: string
  text: string | null
  type: ObsType
  title: string | null
  subtitle: string | null
  facts: string[] | null
  narrative: string | null
  concepts: string[] | null
  files_read: string[] | null
  files_modified: string[] | null
  prompt_number: number | null
  created_at: string
  created_at_epoch: number
}

let _ensured = false
let _idCounter = 0

function ensure(): void {
  if (_ensured) return
  try {
    fs.mkdirSync(MEMORY_DIR, { recursive: true })
    if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, "")
    if (!fs.existsSync(OBS_FILE)) fs.writeFileSync(OBS_FILE, "")
    // Set max ID counter to current max
    const sessions = readSessions()
    const obs = readObservations()
    _idCounter = Math.max(
      sessions.reduce((m, s) => Math.max(m, s.id), 0),
      obs.reduce((m, o) => Math.max(m, o.id), 0),
    )
    _ensured = true
  } catch (e) {
    log.error("memory", `ensure failed: ${(e as Error).message}`)
  }
}

function readSessions(): SessionRow[] {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return []
    return fs.readFileSync(SESSIONS_FILE, "utf8")
      .split("\n").filter(Boolean)
      .map((l) => {
        try { return JSON.parse(l) as SessionRow } catch { return null }
      })
      .filter((x): x is SessionRow => Boolean(x))
  } catch { return [] }
}

function readObservations(): ObservationRow[] {
  try {
    if (!fs.existsSync(OBS_FILE)) return []
    return fs.readFileSync(OBS_FILE, "utf8")
      .split("\n").filter(Boolean)
      .map((l) => {
        try { return JSON.parse(l) as ObservationRow } catch { return null }
      })
      .filter((x): x is ObservationRow => Boolean(x))
  } catch { return [] }
}

function append(file: string, row: object): void {
  try {
    fs.appendFileSync(file, JSON.stringify(row) + "\n")
  } catch (e) {
    log.error("memory", `append ${path.basename(file)} failed: ${(e as Error).message}`)
  }
}

function nowParts(): { iso: string; epoch: number } {
  const now = new Date()
  return { iso: now.toISOString(), epoch: now.getTime() }
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function nextId(): number {
  _idCounter += 1
  return _idCounter
}

// ── Sessions ────────────────────────────────────────────────────────
export function startSession(project: Project, userPrompt: string): SessionRow {
  ensure()
  const { iso, epoch } = nowParts()
  const row: SessionRow = {
    id: nextId(),
    content_session_id: makeId("cs"),
    memory_session_id: makeId("ms"),
    project,
    user_prompt: userPrompt,
    started_at: iso,
    started_at_epoch: epoch,
    completed_at: null,
    completed_at_epoch: null,
    status: "active",
  }
  append(SESSIONS_FILE, row)
  return row
}

export function completeSession(memorySessionId: string, status: "completed" | "failed" = "completed"): void {
  ensure()
  const all = readSessions()
  const { iso, epoch } = nowParts()
  // Rewrite the file with the updated row
  const updated = all.map((s) =>
    s.memory_session_id === memorySessionId
      ? { ...s, completed_at: iso, completed_at_epoch: epoch, status }
      : s,
  )
  fs.writeFileSync(SESSIONS_FILE, updated.map((r) => JSON.stringify(r)).join("\n") + "\n")
}

// ── Observations ────────────────────────────────────────────────────
export function recordObservation(input: {
  memorySessionId: string
  project?: Project
  type: ObsType
  title?: string
  subtitle?: string
  text?: string
  facts?: string[]
  narrative?: string
  concepts?: string[]
  filesRead?: string[]
  filesModified?: string[]
  promptNumber?: number
}): ObservationRow {
  ensure()
  const { iso, epoch } = nowParts()
  const row: ObservationRow = {
    id: nextId(),
    memory_session_id: input.memorySessionId,
    project: input.project ?? "autofarm",
    text: input.text ?? null,
    type: input.type,
    title: input.title ?? null,
    subtitle: input.subtitle ?? null,
    facts: input.facts ?? null,
    narrative: input.narrative ?? null,
    concepts: input.concepts ?? null,
    files_read: input.filesRead ?? null,
    files_modified: input.filesModified ?? null,
    prompt_number: input.promptNumber ?? null,
    created_at: iso,
    created_at_epoch: epoch,
  }
  append(OBS_FILE, row)
  return row
}

// ── 3-layer search ──────────────────────────────────────────────────

/** LAYER 1: compact index. Returns ~50-100 tokens per result. */
export function search(args: {
  query?: string
  type?: ObsType | "all"
  project?: Project
  limit?: number
  days?: number
}): { totalResults: number; observations: { id: number; type: string; title: string | null; created_at: string; snippet: string }[] } {
  ensure()
  const limit = args.limit ?? 20
  const cutoff = args.days ? Date.now() - args.days * 86_400_000 : 0
  const all = readObservations()
  const filtered = all.filter((o) => {
    if (args.project && args.project !== "all" && o.project !== args.project) return false
    if (args.type && args.type !== "all" && o.type !== args.type) return false
    if (cutoff > 0 && o.created_at_epoch < cutoff) return false
    if (args.query && args.query.trim()) {
      const q = args.query.toLowerCase()
      const hay = `${o.title ?? ""} ${o.text ?? ""} ${(o.concepts ?? []).join(" ")}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
  filtered.sort((a, b) => b.created_at_epoch - a.created_at_epoch)
  const top = filtered.slice(0, limit)
  return {
    totalResults: top.length,
    observations: top.map((o) => ({
      id: o.id,
      type: o.type,
      title: o.title,
      created_at: o.created_at,
      snippet: makeSnippet(o, args.query ?? ""),
    })),
  }
}

function makeSnippet(o: ObservationRow, q: string): string {
  const text = o.text ?? o.title ?? o.narrative ?? ""
  if (!q || text.length < 80) return text.slice(0, 80)
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return text.slice(0, 80)
  const start = Math.max(0, idx - 30)
  return (start > 0 ? "…" : "") + text.slice(start, start + 80) + (start + 80 < text.length ? "…" : "")
}

/** LAYER 2: chronological window around an anchor. */
export function timeline(args: { anchor?: number; project?: Project; depthBefore?: number; depthAfter?: number }): ObservationRow[] {
  ensure()
  const depthBefore = (args.depthBefore ?? 10) * 86_400_000
  const depthAfter = (args.depthAfter ?? 10) * 86_400_000
  const epoch = args.anchor ?? Date.now()
  const all = readObservations()
  return all
    .filter((o) => o.created_at_epoch >= epoch - depthBefore && o.created_at_epoch <= epoch + depthAfter)
    .filter((o) => !args.project || args.project === "all" || o.project === args.project)
    .sort((a, b) => b.created_at_epoch - a.created_at_epoch)
    .slice(0, args.depthBefore! + args.depthAfter!)
}

/** LAYER 3: full hydrate by IDs. */
export function getObservationsByIds(ids: number[]): ObservationRow[] {
  ensure()
  if (ids.length === 0) return []
  const set = new Set(ids)
  return readObservations().filter((o) => set.has(o.id))
}

export function getStats(): { sessions: number; observations: number; oldest: string | null } {
  ensure()
  const sessions = readSessions()
  const obs = readObservations()
  const oldest = obs.length ? obs.reduce((m, o) => (o.created_at < m ? o.created_at : m), obs[0].created_at) : null
  return { sessions: sessions.length, observations: obs.length, oldest }
}

export function memoryDir(): string {
  return MEMORY_DIR
}
