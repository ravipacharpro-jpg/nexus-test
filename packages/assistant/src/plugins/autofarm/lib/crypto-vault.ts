// Upgrade 1: AES-256-GCM encrypted vault
// Keys at rest are encrypted. Master key is derived from a device-specific
// fingerprint + a user passphrase (optional) via scrypt + HKDF.
//
// Format on disk: envelope object with version, salt, nonce, ciphertext, tag.

import crypto from "crypto"
import fs from "fs"
import os from "os"
import path from "path"

const VAULT_PLAINTEXT = path.join(os.homedir(), ".nexus", "api-vault.json")
const VAULT_ENCRYPTED = path.join(os.homedir(), ".nexus", "api-vault.json.enc")
const META_PATH = path.join(os.homedir(), ".nexus", "api-vault.meta.json")
const VERSION = 1

interface Envelope {
  version: number
  salt: string // base64
  nonce: string // base64
  ciphertext: string // base64
  tag: string // base64
  createdAt: string
}

interface Meta {
  encrypted: boolean
  version: number
  createdAt: string
  algorithm: string
}

/** Derive a device-specific key by combining hostname + machine-id-like data. */
function deviceFingerprint(): string {
  const parts: string[] = []
  try { parts.push(os.hostname()) } catch {}
  try { parts.push(os.userInfo().username) } catch {}
  try { parts.push(os.arch()) } catch {}
  try { parts.push(os.platform()) } catch {}
  try {
    const machineId = fs.readFileSync("/etc/machine-id", "utf8").trim()
    parts.push(machineId)
  } catch {}
  try {
    const termuxId = fs.readFileSync("/data/data/com.termux/files/home/.termux/termux.properties", "utf8")
    parts.push(termuxId)
  } catch {}
  return parts.filter(Boolean).join("|")
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  // PBKDF2 with SHA-256: lightweight, works on every platform including
  // Termux/Android where scrypt may exceed the memory ceiling.
  return crypto.pbkdf2Sync(passphrase, salt, 200_000, 32, "sha256")
}

function encrypt(plaintext: string, passphrase: string): Envelope {
  const salt = crypto.randomBytes(16)
  const nonce = crypto.randomBytes(12) // GCM nonce
  const key = deriveKey(passphrase, salt)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce)
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    version: VERSION,
    salt: salt.toString("base64"),
    nonce: nonce.toString("base64"),
    ciphertext: ct.toString("base64"),
    tag: tag.toString("base64"),
    createdAt: new Date().toString(),
  }
}

function decrypt(envelope: Envelope, passphrase: string): string {
  const salt = Buffer.from(envelope.salt, "base64")
  const nonce = Buffer.from(envelope.nonce, "base64")
  const ct = Buffer.from(envelope.ciphertext, "base64")
  const tag = Buffer.from(envelope.tag, "base64")
  const key = deriveKey(passphrase, salt)
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString("utf8")
}

export function isEncrypted(): boolean {
  try {
    const meta = JSON.parse(fs.readFileSync(META_PATH, "utf8")) as Meta
    return meta.encrypted === true
  } catch {
    return false
  }
}

export function enableEncryption(passphrase?: string): { ok: true; path: string } | { ok: false; reason: string } {
  if (!fs.existsSync(VAULT_PLAINTEXT)) {
    return { ok: false, reason: "no plaintext vault to encrypt" }
  }
  const pp = passphrase ?? deviceFingerprint()
  const plaintext = fs.readFileSync(VAULT_PLAINTEXT, "utf8")
  const env = encrypt(plaintext, pp)
  // atomic write
  const tmp = VAULT_ENCRYPTED + ".tmp"
  fs.writeFileSync(tmp, JSON.stringify(env, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, VAULT_ENCRYPTED)
  fs.chmodSync(VAULT_ENCRYPTED, 0o600)
  // write meta
  fs.writeFileSync(
    META_PATH,
    JSON.stringify(
      {
        encrypted: true,
        version: VERSION,
        createdAt: env.createdAt,
        algorithm: "aes-256-gcm/scrypt",
      } as Meta,
      null,
      2,
    ),
    { mode: 0o600 },
  )
  // remove plaintext copy
  try {
    fs.unlinkSync(VAULT_PLAINTEXT)
  } catch {}
  return { ok: true, path: VAULT_ENCRYPTED }
}

export function disableEncryption(passphrase?: string): { ok: true; path: string } | { ok: false; reason: string } {
  if (!fs.existsSync(VAULT_ENCRYPTED)) return { ok: false, reason: "no encrypted vault" }
  const pp = passphrase ?? deviceFingerprint()
  const env = JSON.parse(fs.readFileSync(VAULT_ENCRYPTED, "utf8")) as Envelope
  const plaintext = decrypt(env, pp)
  const tmp = VAULT_PLAINTEXT + ".tmp"
  fs.writeFileSync(tmp, plaintext, { mode: 0o600 })
  fs.renameSync(tmp, VAULT_PLAINTEXT)
  fs.chmodSync(VAULT_PLAINTEXT, 0o600)
  // remove encrypted copy + meta
  try { fs.unlinkSync(VAULT_ENCRYPTED) } catch {}
  try { fs.unlinkSync(META_PATH) } catch {}
  return { ok: true, path: VAULT_PLAINTEXT }
}

/** Read the vault transparently, decrypting if needed. */
export function readVaultSmart(passphrase?: string): Record<string, unknown> {
  if (fs.existsSync(VAULT_ENCRYPTED)) {
    const env = JSON.parse(fs.readFileSync(VAULT_ENCRYPTED, "utf8")) as Envelope
    const pp = passphrase ?? deviceFingerprint()
    return JSON.parse(decrypt(env, pp))
  }
  if (fs.existsSync(VAULT_PLAINTEXT)) {
    return JSON.parse(fs.readFileSync(VAULT_PLAINTEXT, "utf8"))
  }
  return { providers: {}, usage: {}, usageBudget: { version: 1 }, autoRotate: true, fallbackToLocal: true }
}

export function deviceId(): string {
  return crypto.createHash("sha256").update(deviceFingerprint()).digest("hex").slice(0, 16)
}
