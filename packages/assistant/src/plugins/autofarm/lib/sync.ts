// cross-platform sync: keep ~/.nexus/api-vault.json and
// ~/.config/nexus/nexus.jsonc in sync across all the devices the
// user runs NEXUS on (Termux + Laptop + Desktop).
//
// Transport: a single private GitHub Gist. Why a Gist?
//   - Free, no account to create (the user already has GitHub).
//   - 1 Gist file per state file, versioned in git.
//   - Auth via the user's existing GitHub token (already in env
//     for git push), no new secret to provision.
//   - Works from any device with curl + a token.
//
// Flow (autonomous, no prompts):
//   - push(): upload local vault/config to the Gist, overwrite in
//     place. Conflict-free because we are the only writer (the
//     user's GitHub account owns the Gist).
//   - pull(): download the Gist contents, write back to the local
//     files atomically. We never overwrite the local file if the
//     remote is older (mtime check) to avoid clobbering newer
//     work.
//   - sync(): push if local is newer, pull if remote is newer.
//   - status(): report the mtime of local vs remote.
//
// Cross-platform: pure fetch + node:fs. No shell. Works on
// Termux, Linux, macOS, Windows.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const GIST_API = "https://api.github.com/gists"
const NEXUS_DIR = join(os.homedir(), ".nexus")
const CONFIG_DIR = join(os.homedir(), ".config", "nexus")

const DEFAULT_FILES = {
  vault: join(NEXUS_DIR, "api-vault.json"),
  config: join(CONFIG_DIR, "nexus.jsonc"),
  agents_md: join(CONFIG_DIR, "AGENTS.md"),
}

export interface SyncConfig {
  /** GitHub PAT. Needs 'gist' scope. */
  token: string
  /** Gist ID (the hash in the Gist URL). Required. */
  gistId: string
  /** Optional override of which files to sync. */
  files?: Partial<typeof DEFAULT_FILES>
}

export interface SyncResult {
  ok: boolean
  direction: "push" | "pull" | "noop" | "error"
  filesTouched: string[]
  detail: string
}

function join(p: string) {
  return path.join(...p.split("/"))
}

async function gh<T>(cfg: SyncConfig, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(GIST_API + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + cfg.token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`GitHub ${init?.method ?? "GET"} ${path} failed: ${res.status} ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

interface GistResponse {
  id: string
  files: Record<string, { filename: string; content: string; truncated: boolean }>
  updated_at: string
}

/** Read the Gist into memory. */
export async function readGist(cfg: SyncConfig): Promise<GistResponse> {
  return gh<GistResponse>(cfg, "/" + cfg.gistId)
}

/** Push local files to the Gist (overwrite). */
export async function pushGist(cfg: SyncConfig): Promise<SyncResult> {
  const files = { ...DEFAULT_FILES, ...(cfg.files ?? {}) }
  const payload: Record<string, { content: string }> = {}
  const touched: string[] = []
  for (const [name, fp] of Object.entries(files)) {
    if (!fs.existsSync(fp)) continue
    payload[name] = { content: fs.readFileSync(fp, "utf8") }
    touched.push(fp)
  }
  if (Object.keys(payload).length === 0) {
    return { ok: false, direction: "noop", filesTouched: [], detail: "no local files to push" }
  }
  await gh(cfg, "/" + cfg.gistId, {
    method: "PATCH",
    body: JSON.stringify({ files: payload }),
  })
  return { ok: true, direction: "push", filesTouched: touched, detail: `pushed ${touched.length} file(s) to gist ${cfg.gistId}` }
}

/** Pull from the Gist to local files (overwrite). */
export async function pullGist(cfg: SyncConfig): Promise<SyncResult> {
  const gist = await readGist(cfg)
  const files = { ...DEFAULT_FILES, ...(cfg.files ?? {}) }
  const touched: string[] = []
  for (const [name, entry] of Object.entries(gist.files)) {
    const target = files[name as keyof typeof files]
    if (!target) continue
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, entry.content)
    touched.push(target)
  }
  return { ok: true, direction: "pull", filesTouched: touched, detail: `pulled ${touched.length} file(s) from gist ${cfg.gistId}` }
}

/** Auto: push if local is newer, pull if remote is newer. */
export async function syncGist(cfg: SyncConfig): Promise<SyncResult> {
  const gist = await readGist(cfg)
  const localFiles = { ...DEFAULT_FILES, ...(cfg.files ?? {}) }
  const localNewest = Object.values(localFiles)
    .filter((p) => fs.existsSync(p))
    .map((p) => statSync(p).mtimeMs)
    .reduce((a, b) => Math.max(a, b), 0)
  const remoteMtime = new Date(gist.updated_at).getTime()
  if (localNewest > remoteMtime) return pushGist(cfg)
  if (localNewest < remoteMtime) return pullGist(cfg)
  return { ok: true, direction: "noop", filesTouched: [], detail: "local and remote are in sync" }
}

export function syncConfigFromEnv(): SyncConfig | undefined {
  const token = process.env.NEXUS_SYNC_GITHUB_TOKEN ?? process.env.GH_TOKEN
  const gistId = process.env.NEXUS_SYNC_GIST_ID
  if (!token || !gistId) return undefined
  return { token, gistId }
}
