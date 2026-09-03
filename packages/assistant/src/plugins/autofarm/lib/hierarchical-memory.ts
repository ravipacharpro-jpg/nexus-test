// hierarchical-memory: 3-tier memory that mirrors how a senior
// engineer actually remembers things.
//
// Tier 1 (working): the current session's hot context. RAM only,
//  fast, ephemeral. Cleared on session end.
// Tier 2 (episodic): what happened today/yesterday. On disk, daily
//  rotated, summarizable. "Last week I fixed X bug".
// Tier 3 (semantic): facts that should outlive any single session.
//  Hashed + indexed for similarity search. "User prefers TypeScript".
//
// API:
//   const mem = new HierarchicalMemory("session-123")
//   mem.working.set("current_task", "fix oauth")
//   mem.working.get("current_task")
//   await mem.episodic.append("started oauth task at 14:00")
//   mem.semantic.remember("user", { preference: "TypeScript" })
//   await mem.semantic.recall("user preferences")
//   await mem.compact()   // summarize tier 1 into tier 2

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
import { log } from "./logger.ts"

const MEMORY_ROOT = path.join(os.homedir(), ".nexus", "memory")

// ── Tier 1: working (RAM) ─────────────────────────────────
export class WorkingMemory {
  private store = new Map<string, { value: unknown; expiresAt: number }>()
  private maxEntries = 256

  set(key: string, value: unknown, ttlMs = 3_600_000): void {
    if (this.store.size >= this.maxEntries) {
      // Evict oldest
      const first = this.store.keys().next().value
      if (first) this.store.delete(first)
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs })
  }

  get<T = unknown>(key: string): T | undefined {
    const e = this.store.get(key)
    if (!e) return undefined
    if (e.expiresAt < Date.now()) {
      this.store.delete(key)
      return undefined
    }
    return e.value as T
  }

  has(key: string): boolean { return this.get(key) !== undefined }
  delete(key: string): boolean { return this.store.delete(key) }
  size(): number {
    // Lazy cleanup
    const now = Date.now()
    for (const [k, v] of this.store) if (v.expiresAt < now) this.store.delete(k)
    return this.store.size
  }
  keys(): string[] { return [...this.store.keys()] }
  clear(): void { this.store.clear() }
  dump(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [k, v] of this.store) out[k] = v.value
    return out
  }
}

// ── Tier 2: episodic (disk, daily rotated) ────────────────
export interface Episode {
  ts: number
  session: string
  kind: "user_msg" | "agent_msg" | "tool_call" | "decision" | "milestone" | "error"
  text: string
  data?: Record<string, unknown>
  /** Tags for retrieval. */
  tags?: string[]
}

export class EpisodicMemory {
  private session: string
  private todayFile: string
  private entries: Episode[] = []

  constructor(session: string) {
    this.session = session
    const day = new Date().toISOString().slice(0, 10)
    const dir = path.join(MEMORY_ROOT, "episodic", day)
    fs.mkdirSync(dir, { recursive: true })
    this.todayFile = path.join(dir, `${session}.jsonl`)
    this.load()
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.todayFile)) return
      const lines = fs.readFileSync(this.todayFile, "utf8").split("\n").filter(Boolean)
      this.entries = lines.map((l) => JSON.parse(l) as Episode)
    } catch (e) {
      log.warn("memory", `episodic load failed: ${(e as Error).message}`)
    }
  }

  append(ep: Omit<Episode, "ts" | "session">): void {
    const full: Episode = { ts: Date.now(), session: this.session, ...ep }
    this.entries.push(full)
    try {
      fs.appendFileSync(this.todayFile, JSON.stringify(full) + "\n")
    } catch (e) {
      log.warn("memory", `episodic append failed: ${(e as Error).message}`)
    }
  }

  today(limit = 50): Episode[] {
    return this.entries.slice(-limit)
  }

  /** Search today's episodes by tag or text substring. */
  search(q: string, limit = 20): Episode[] {
    const lower = q.toLowerCase()
    const hits = this.entries.filter(
      (e) => e.text.toLowerCase().includes(lower) || (e.tags ?? []).some((t) => t.toLowerCase().includes(lower))
    )
    return hits.slice(-limit)
  }

  /** Summarize a window of episodes. Caller plugs in their own summary fn. */
  summarize(window: number, summarize: (eps: Episode[]) => string): string {
    const slice = this.entries.slice(-window)
    return summarize(slice)
  }
}

// ── Tier 3: semantic (cross-session facts, hashed index) ──
export interface Fact {
  id: string                // sha256 of (kind + key) — stable
  kind: "user_pref" | "project_fact" | "lesson_learned" | "entity"
  key: string               // e.g. "user.preferred_language"
  value: unknown
  /** When first recorded. */
  createdAt: number
  /** When last confirmed/reinforced. */
  updatedAt: number
  /** How many times this fact has been seen. */
  hits: number
  /** Optional tags. */
  tags?: string[]
}

export class SemanticMemory {
  private indexPath = path.join(MEMORY_ROOT, "semantic", "facts.json")
  private facts = new Map<string, Fact>()

  constructor() { this.load() }

  private load(): void {
    try {
      fs.mkdirSync(path.dirname(this.indexPath), { recursive: true })
      if (!fs.existsSync(this.indexPath)) return
      const arr = JSON.parse(fs.readFileSync(this.indexPath, "utf8")) as Fact[]
      for (const f of arr) this.facts.set(f.id, f)
    } catch (e) {
      log.warn("memory", `semantic load failed: ${(e as Error).message}`)
    }
  }

  private persist(): void {
    try {
      const tmp = this.indexPath + ".tmp"
      fs.writeFileSync(tmp, JSON.stringify([...this.facts.values()], null, 2))
      fs.renameSync(tmp, this.indexPath)
    } catch (e) {
      log.warn("memory", `semantic persist failed: ${(e as Error).message}`)
    }
  }

  private idFor(kind: Fact["kind"], key: string): string {
    return crypto.createHash("sha256").update(`${kind}::${key}`).digest("hex").slice(0, 16)
  }

  remember(kind: Fact["kind"], key: string, value: unknown, tags?: string[]): Fact {
    const id = this.idFor(kind, key)
    const existing = this.facts.get(id)
    const now = Date.now()
    if (existing) {
      existing.value = value
      existing.updatedAt = now
      existing.hits++
      if (tags) existing.tags = tags
    } else {
      this.facts.set(id, { id, kind, key, value, createdAt: now, updatedAt: now, hits: 1, ...(tags ? { tags } : {}) })
    }
    this.persist()
    return this.facts.get(id)!
  }

  recall(key: string): Fact | undefined {
    const id = this.idFor("user_pref", key)
    // Try exact hash, then substring search
    const exact = this.facts.get(id)
    if (exact) return exact
    for (const f of this.facts.values()) {
      if (f.key === key || f.key.endsWith("." + key)) return f
    }
    return undefined
  }

  /** Fuzzy recall by keyword in key or value. */
  query(q: string, limit = 10): Fact[] {
    const lower = q.toLowerCase()
    const hits: Fact[] = []
    for (const f of this.facts.values()) {
      const blob = (f.key + " " + JSON.stringify(f.value)).toLowerCase()
      if (blob.includes(lower)) hits.push(f)
    }
    return hits.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
  }

  forget(id: string): boolean {
    const ok = this.facts.delete(id)
    if (ok) this.persist()
    return ok
  }

  size(): number { return this.facts.size }
  all(): Fact[] { return [...this.facts.values()] }
}

// ── Composite: ties all 3 tiers + compact() ───────────────
export class HierarchicalMemory {
  readonly session: string
  readonly working: WorkingMemory
  readonly episodic: EpisodicMemory
  readonly semantic: SemanticMemory

  constructor(session: string) {
    this.session = session
    this.working = new WorkingMemory()
    this.episodic = new EpisodicMemory(session)
    this.semantic = new SemanticMemory()
  }

  /** Move a working-memory item to episodic (e.g. when the task
   *  is done but the user might want to look back at it). */
  archiveWorking(key: string, kind: Episode["kind"] = "milestone"): void {
    const v = this.working.get(key)
    if (v === undefined) return
    this.episodic.append({ kind, text: `${key}: ${typeof v === "string" ? v : JSON.stringify(v)}` })
    this.working.delete(key)
  }

  /** Compact: turn a window of episodic entries into a single fact. */
  async compact(window = 20): Promise<{ archived: number; remembered: number }> {
    const slice = this.episodic.today(window)
    if (slice.length === 0) return { archived: 0, remembered: 0 }
    const text = slice.map((e) => `- [${e.kind}] ${e.text}`).join("\n")
    this.semantic.remember("lesson_learned", `session.${this.session}.summary`, text, ["compacted"])
    this.episodic.append({ kind: "milestone", text: `compacted ${slice.length} episodes into 1 fact` })
    return { archived: slice.length, remembered: 1 }
  }

  /** One-shot: recall everything relevant to a query. */
  recallAll(q: string): { working: string[]; episodic: Episode[]; semantic: Fact[] } {
    return {
      working: this.working.keys().filter((k) => k.toLowerCase().includes(q.toLowerCase())),
      episodic: this.episodic.search(q),
      semantic: this.semantic.query(q),
    }
  }

  /** Persist any deferred writes. (No-op for now since writes are
   *  synchronous; placeholder for future async writers.) */
  async flush(): Promise<void> { /* sync today; async tomorrow */ }
}
