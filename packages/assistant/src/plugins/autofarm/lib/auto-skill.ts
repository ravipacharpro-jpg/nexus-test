// auto-skill: detect when the user has performed the same task
// several times, and propose turning it into a reusable "skill"
// that the agent can invoke with a single word next time.
//
// The classic pattern: "I keep running `git status && git pull
// && npm install && npm test` — make that a one-liner." Auto-skill
// notices the repetition and offers to create a `skill/` entry.
//
// Storage: ~/.nexus/autofarm/auto-skill/<date>.jsonl
//   each row: { ts, signature, count, sample, lastSeen }
// Signature = normalized key derived from the task tokens (verbs +
// paths, no filler words).

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
import { log } from "./logger.ts"

const STORE_DIR = path.join(os.homedir(), ".nexus", "autofarm", "auto-skill")
const FINGERPRINT_FILE = path.join(STORE_DIR, "fingerprints.jsonl")
const SUGGESTION_FILE = path.join(STORE_DIR, "suggestions.json")

const FILLER = new Set(["the", "a", "an", "please", "can", "you", "could", "would", "i", "to", "for", "on", "in", "of", "and", "or", "with", "my", "this", "that", "it", "me"])

export interface Fingerprint {
  id: string         // sha256 of signature
  signature: string  // normalized task key
  count: number
  firstSeen: number
  lastSeen: number
  samples: string[]  // last 3 user phrasings
}

export interface Suggestion {
  fingerprint: string
  signature: string
  count: number
  proposedName: string
  proposedCommand: string
  confidence: number
  generatedAt: number
  status: "pending" | "accepted" | "dismissed" | "created"
}

/** Normalize a user request into a stable signature. */
export function fingerprint(text: string): string {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s\/.]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !FILLER.has(t) && t.length > 1)
    .slice(0, 12)
  return tokens.sort().join(" ")
}

function idFor(sig: string): string {
  return crypto.createHash("sha256").update(sig).digest("hex").slice(0, 12)
}

function ensure(): void { fs.mkdirSync(STORE_DIR, { recursive: true }) }

function loadAll(): Fingerprint[] {
  ensure()
  try {
    if (!fs.existsSync(FINGERPRINT_FILE)) return []
    return fs.readFileSync(FINGERPRINT_FILE, "utf8")
      .split("\n").filter(Boolean)
      .map((l) => JSON.parse(l) as Fingerprint)
  } catch { return [] }
}

function saveAll(list: Fingerprint[]): void {
  ensure()
  const tmp = FINGERPRINT_FILE + ".tmp"
  fs.writeFileSync(tmp, list.map((f) => JSON.stringify(f)).join("\n") + "\n")
  fs.renameSync(tmp, FINGERPRINT_FILE)
}

function loadSuggestions(): Suggestion[] {
  try {
    if (!fs.existsSync(SUGGESTION_FILE)) return []
    return JSON.parse(fs.readFileSync(SUGGESTION_FILE, "utf8")) as Suggestion[]
  } catch { return [] }
}

function saveSuggestions(list: Suggestion[]): void {
  const tmp = SUGGESTION_FILE + ".tmp"
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2))
  fs.renameSync(tmp, SUGGESTION_FILE)
}

/** Record a user task. Returns the (possibly new) fingerprint. */
export function observe(text: string): Fingerprint {
  const sig = fingerprint(text)
  const id = idFor(sig)
  const list = loadAll()
  const existing = list.find((f) => f.id === id)
  const now = Date.now()
  if (existing) {
    existing.count++
    existing.lastSeen = now
    if (!existing.samples.includes(text)) {
      existing.samples.push(text)
      if (existing.samples.length > 3) existing.samples.shift()
    }
  } else {
    list.push({ id, signature: sig, count: 1, firstSeen: now, lastSeen: now, samples: [text] })
  }
  saveAll(list)
  return list.find((f) => f.id === id)!
}

/** Inspect fingerprints and propose skills for high-frequency ones. */
export function propose(threshold = 3): Suggestion[] {
  const list = loadAll()
  const existing = new Set(loadSuggestions().filter((s) => s.status === "pending" || s.status === "accepted").map((s) => s.fingerprint))
  const out: Suggestion[] = []
  for (const f of list) {
    if (f.count < threshold) continue
    if (existing.has(f.id)) continue
    const conf = Math.min(1, (f.count - threshold + 1) / 10)
    out.push({
      fingerprint: f.id,
      signature: f.signature,
      count: f.count,
      proposedName: suggestName(f.signature),
      proposedCommand: suggestCommand(f.samples[0] ?? f.signature),
      confidence: conf,
      generatedAt: Date.now(),
      status: "pending",
    })
  }
  if (out.length > 0) {
    const all = loadSuggestions()
    saveSuggestions([...all, ...out])
  }
  return out
}

function suggestName(sig: string): string {
  const parts = sig.split(" ").filter((p) => p.length > 1).slice(0, 4)
  return parts.join("-").replace(/[^a-z0-9\-]/g, "")
}

function suggestCommand(sample: string): string {
  // Heuristic: detect verb at the start
  const first = sample.split(/\s+/)[0]?.toLowerCase() ?? "do"
  return `${first} (${sample.slice(0, 60)})`
}

/** List pending suggestions. */
export function listSuggestions(): Suggestion[] {
  return loadSuggestions().filter((s) => s.status === "pending")
}

/** Mark a suggestion accepted / dismissed / created. */
export function updateSuggestion(fp: string, status: Suggestion["status"]): void {
  const all = loadSuggestions()
  const s = all.find((x) => x.fingerprint === fp)
  if (s) {
    s.status = status
    saveSuggestions(all)
  }
}

/** Render as one-liner list. */
export function formatSuggestions(sugs: Suggestion[]): string {
  if (sugs.length === 0) return "(no pending suggestions)"
  return sugs
    .map((s, i) => `  ${i + 1}. [${(s.confidence * 100).toFixed(0)}%] ${s.proposedName} — seen ${s.count}x: "${s.signature}"`)
    .join("\n")
}

/** Stats for observability. */
export function stats(): { total: number; unique: number; pending: number } {
  const list = loadAll()
  const sugs = loadSuggestions()
  return {
    total: list.reduce((s, f) => s + f.count, 0),
    unique: list.length,
    pending: sugs.filter((s) => s.status === "pending").length,
  }
}
