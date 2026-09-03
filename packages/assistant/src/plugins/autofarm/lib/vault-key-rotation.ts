// vault-key-rotation: round-robin through ALL active OpenRouter
// keys in ~/.nexus/api-vault.json. When the dispatcher asks for
// an OpenRouter key, it now gets a different key each call so
// 1314 requests don't all hit the same key and burn through
// its daily quota.
//
// User pain point: aaj ke 240M+ OpenRouter tokens + 1314 requests
// sab ek hi key se. 5 keys hain but koi rotation nahi — first key
// hi baar baar use hoti hai. Ab round-robin + failure-driven
// fallback (jab key pe 429/4xx aaye, next key try kare).

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

interface VaultShape {
  providers?: Record<string, Array<{ key: string; status?: string; lastUsed?: string; failures?: number }>>
}

const ROTATION_STATE = path.join(os.homedir(), ".nexus", "autofarm", "key-rotation.json")

interface RotationState {
  /** Last-used index in the global active-keys list. */
  cursor: number
  /** Per-key failure count, so a 429-storm on one key can back it off. */
  failures: Record<string, number>
  /** Per-key cooldown expiry (epoch ms). When > now, the key is skipped. */
  cooldownUntil: Record<string, number>
  /** Last reset of the day (YYYY-MM-DD). We clear the cursor each day. */
  day: string
}

function emptyState(): RotationState {
  return { cursor: 0, failures: {}, cooldownUntil: {}, day: new Date().toISOString().slice(0, 10) }
}

function loadState(): RotationState {
  try {
    if (!fs.existsSync(ROTATION_STATE)) return emptyState()
    const j = JSON.parse(fs.readFileSync(ROTATION_STATE, "utf8")) as RotationState
    const today = new Date().toISOString().slice(0, 10)
    if (j.day !== today) return emptyState()
    return j
  } catch {
    return emptyState()
  }
}

function saveState(s: RotationState): void {
  try {
    fs.mkdirSync(path.dirname(ROTATION_STATE), { recursive: true })
    fs.writeFileSync(ROTATION_STATE, JSON.stringify(s, null, 2))
  } catch {
    // best-effort
  }
}

/** Pull every active OpenRouter key out of the vault, in
 *  stable order (so the cursor is meaningful). */
export function listOpenRouterKeys(vaultPath?: string): string[] {
  const vp = vaultPath ?? path.join(os.homedir(), ".nexus", "api-vault.json")
  if (!fs.existsSync(vp)) return []
  try {
    const j = JSON.parse(fs.readFileSync(vp, "utf8")) as VaultShape
    const out: string[] = []
    for (const list of Object.values(j.providers ?? {})) {
      for (const e of list ?? []) {
        if (e.status === "active") out.push(e.key)
      }
    }
    return out
  } catch {
    return []
  }
}

/** Pick the next OpenRouter key using round-robin + cooldown.
 *  Returns undefined if every key is currently in cooldown. */
export function pickNextKey(vaultPath?: string): string | undefined {
  const keys = listOpenRouterKeys(vaultPath)
  if (keys.length === 0) return undefined
  const state = loadState()
  const now = Date.now()
  // Try each key, starting at the cursor, until we find one not in cooldown.
  for (let i = 0; i < keys.length; i++) {
    const idx = (state.cursor + i) % keys.length
    const key = keys[idx]!
    const cd = state.cooldownUntil[key] ?? 0
    if (cd > now) continue
    // Advance cursor for next call.
    state.cursor = (idx + 1) % keys.length
    saveState(state)
    return key
  }
  return undefined
}

/** Record that a key just had a 429 / quota error. Back off
 *  for 5 minutes; repeated failures in the same day back off
 *  for 1 hour. */
export function recordKeyRateLimit(key: string): void {
  const s = loadState()
  s.failures[key] = (s.failures[key] ?? 0) + 1
  const failures = s.failures[key]!
  const cooldownMs = failures >= 3 ? 60 * 60_000 : 5 * 60_000
  s.cooldownUntil[key] = Date.now() + cooldownMs
  saveState(s)
}

/** Record that a key was used successfully. Clears any cooldown. */
export function recordKeySuccess(key: string): void {
  const s = loadState()
  delete s.cooldownUntil[key]
  s.failures[key] = 0
  saveState(s)
}

/** Human-readable status of every key + its cooldown. */
export function rotationReport(vaultPath?: string): string {
  const keys = listOpenRouterKeys(vaultPath)
  if (keys.length === 0) return "No active OpenRouter keys in ~/.nexus/api-vault.json"
  const s = loadState()
  const now = Date.now()
  const lines: string[] = []
  lines.push(`OpenRouter key rotation — ${keys.length} active key(s)`)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!
    const masked = k.slice(0, 12) + "…" + k.slice(-4)
    const cd = s.cooldownUntil[k] ?? 0
    const failures = s.failures[k] ?? 0
    const cooldown = cd > now ? Math.ceil((cd - now) / 60000) + "m" : "ok"
    const cursor = i === s.cursor ? "← next" : ""
    lines.push(`  [${cooldown.padEnd(4)}] ${masked}  fails=${failures}  ${cursor}`)
  }
  return lines.join("\n")
}
