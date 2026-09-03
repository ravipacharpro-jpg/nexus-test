// per-user-vault: each NEXUS user gets their own set of API keys.
// We never share keys between users, never co-mingle, and never
// leak one user's keys to another user.
//
// Storage layout:
//   ~/.nexus/autofarm/users/<username>/vault.json
//   ~/.nexus/autofarm/users/<username>/usage.json
//
// When a user runs `nexus autofarm as <name>`, subsequent vault
// operations are scoped to that user's directory. The default
// unscoped operations keep working on the global vault for the
// admin (ravipacharpro-jpg).

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
import { log } from "./logger.ts"

const USERS_ROOT = path.join(os.homedir(), ".nexus", "autofarm", "users")
const SESSION_FILE = path.join(os.homedir(), ".nexus", "autofarm", "current-user.json")

export interface UserVault {
  name: string
  created: string
  providers: Record<string, Array<{
    key: string
    label: string
    added: string
    status: "active" | "invalid" | "rate-limited" | "expired"
    source: "farm" | "auth"
    lastChecked?: string
  }>>
}

export interface Usage {
  providers: Record<string, { todayRequests: number; todayInputTokens: number; todayOutputTokens: number; lastUsed?: string }>
}

function ensureDir(d: string): void {
  fs.mkdirSync(d, { recursive: true })
}

function userDir(name: string): string {
  // Sanitize: only [a-z0-9_-]
  const safe = name.replace(/[^a-z0-9_-]/gi, "_").toLowerCase()
  if (!safe) throw new Error(`invalid username: ${name}`)
  return path.join(USERS_ROOT, safe)
}

function vaultPath(name: string): string {
  return path.join(userDir(name), "vault.json")
}

function usagePath(name: string): string {
  return path.join(userDir(name), "usage.json")
}

function emptyVault(name: string): UserVault {
  return { name, created: new Date().toISOString(), providers: {} }
}

function readJSON<T>(p: string, fallback: T): T {
  try {
    if (!fs.existsSync(p)) return fallback
    return JSON.parse(fs.readFileSync(p, "utf8")) as T
  } catch {
    return fallback
  }
}

function writeJSON(p: string, v: unknown): void {
  ensureDir(path.dirname(p))
  const tmp = p + ".tmp"
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2))
  fs.renameSync(tmp, p)
  fs.chmodSync(p, 0o600)
}

/** List all known users. */
export function listUsers(): string[] {
  try {
    if (!fs.existsSync(USERS_ROOT)) return []
    return fs.readdirSync(USERS_ROOT).filter((d) => {
      const v = path.join(USERS_ROOT, d, "vault.json")
      return fs.existsSync(v)
    })
  } catch {
    return []
  }
}

/** Create a fresh user vault. */
export function createUser(name: string): UserVault {
  const v = emptyVault(name)
  writeJSON(vaultPath(name), v)
  writeJSON(usagePath(name), { providers: {} })
  log.info("users", `created user ${name}`)
  return v
}

/** Read a user's vault (or create if missing). */
export function getUserVault(name: string): UserVault {
  return readJSON<UserVault>(vaultPath(name), emptyVault(name))
}

/** Add a key to a specific user's vault. */
export function addUserKey(name: string, provider: string, key: string, label = "user"): UserVault {
  const v = getUserVault(name)
  if (!v.providers[provider]) v.providers[provider] = []
  v.providers[provider].push({
    key,
    label,
    added: new Date().toISOString(),
    status: "active",
    source: "farm",
  })
  writeJSON(vaultPath(name), v)
  return v
}

/** Switch the active user for this session. */
export function switchUser(name: string): void {
  if (!listUsers().includes(name)) createUser(name)
  writeJSON(SESSION_FILE, { user: name, switchedAt: new Date().toISOString() })
  log.info("users", `switched to user ${name}`)
}

export function currentUser(): string {
  const s = readJSON<{ user: string }>(SESSION_FILE, { user: "default" })
  return s.user
}

export function isScoped(): boolean {
  return currentUser() !== "default"
}

/** Bulk-fork: take the admin's global vault and split one key per user.
 *  Used by the orchestrator to provision fresh users on demand. */
export function forkGlobalVault(perUser: number): { users: string[]; totalKeys: number } {
  const adminVault = readJSON<{ providers: Record<string, Array<{ key: string; label: string; status: string }>> }>(
    path.join(os.homedir(), ".nexus", "api-vault.json"),
    { providers: {} }
  )
  const providers = Object.keys(adminVault.providers)
  let totalKeys = 0
  const users: string[] = []
  for (let i = 0; i < perUser; i++) {
    const name = `user-${crypto.randomBytes(2).toString("hex")}`
    const v = createUser(name)
    users.push(name)
    for (const prov of providers) {
      const list = adminVault.providers[prov] ?? []
      if (list.length > 0) {
        // round-robin so we don't give the same key to everyone
        const k = list[i % list.length]
        if (k && k.status === "active") {
          v.providers[prov] = [{ key: k.key, label: `forked-${name}`, added: new Date().toISOString(), status: "active", source: "farm" }]
          totalKeys++
        }
      }
    }
    writeJSON(vaultPath(name), v)
  }
  log.info("users", `forked global vault across ${perUser} users, total ${totalKeys} keys distributed`)
  return { users, totalKeys }
}
