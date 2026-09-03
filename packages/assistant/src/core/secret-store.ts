import fs from "fs"
import path from "path"
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto"

/**
 * Encrypted-at-rest secret storage for assistant plugins.
 *
 * Secrets are AES-256-GCM encrypted with a machine-local key held at
 * `~/.nexus/.secret.key` (mode 0600). This is not an OS keychain, but it
 * removes plaintext secrets from disk on every platform including Termux.
 */

const NEXUS_DIR = path.join(process.env.HOME ?? process.cwd(), ".nexus")
const KEY_FILE = path.join(NEXUS_DIR, ".secret.key")
const SECRET_DIR = path.join(NEXUS_DIR, "secrets")

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
  try {
    fs.chmodSync(dir, 0o700)
  } catch {
    // Some Android filesystems ignore chmod; parent dir is already private.
  }
}

function loadOrCreateKey(): Buffer {
  ensureDir(NEXUS_DIR)
  if (fs.existsSync(KEY_FILE)) {
    const existing = fs.readFileSync(KEY_FILE)
    if (existing.length === 32) return existing
  }
  const key = randomBytes(32)
  fs.writeFileSync(KEY_FILE, key, { mode: 0o600 })
  try {
    fs.chmodSync(KEY_FILE, 0o600)
  } catch {}
  return key
}

function secretPath(name: string): string {
  return path.join(SECRET_DIR, `${name.replace(/[^a-z0-9._-]+/gi, "-")}.enc`)
}

export function setSecret(name: string, value: string): void {
  ensureDir(SECRET_DIR)
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", scryptSync(loadOrCreateKey(), salt, 32), iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const payload = JSON.stringify({
    v: 1,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  })
  fs.writeFileSync(secretPath(name), payload, { mode: 0o600 })
  try {
    fs.chmodSync(secretPath(name), 0o600)
  } catch {}
}

export function getSecret(name: string): string | undefined {
  const file = secretPath(name)
  if (!fs.existsSync(file)) return undefined
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8")) as {
      salt: string
      iv: string
      tag: string
      data: string
      v?: number
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      scryptSync(loadOrCreateKey(), Buffer.from(payload.salt, "base64"), 32),
      Buffer.from(payload.iv, "base64"),
    )
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"))
    return Buffer.concat([
      decipher.update(Buffer.from(payload.data, "base64")),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    return undefined
  }
}

export function deleteSecret(name: string): void {
  const file = secretPath(name)
  if (fs.existsSync(file)) fs.unlinkSync(file)
}

export * as SecretStore from "./secret-store"
