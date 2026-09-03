// auto-updater: check the GitHub releases page for a newer
// NEXUS version, report the delta, and (with explicit user
// approval) apply the update.
//
// Why this exists: NEXUS is a multi-device TUI. The user wants
// the latest fixes without manually cloning a new version on
// every device. A pure-TS check against the GitHub API is the
// smallest tool that solves this without depending on git
// remotes, package managers, or OOBE prompts.
//
// Flow:
//   1. fetchLatestRelease(): GET
//      https://api.github.com/repos/OWNER/REPO/releases/latest
//   2. readLocalVersion(): read VERSION file or package.json
//   3. compareVersions(): simple semver-ish compare on
//      "v0.1.71" / "0.1.71" / "0.1.72-rc1"
//   4. formatUpdateReport(): pretty multi-line status for the CLI
//   5. applyUpdate(): spawn `git pull` (only when the user
//      confirms). Never auto-applies.

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const DEFAULT_REPO = "ravipacharpro-jpg/nexus-agent"

export interface UpdateConfig {
  /** GitHub owner/repo. Default: the NEXUS public repo. */
  repo?: string
  /** Override path to the local repo root (where 'git pull' runs). */
  cwd?: string
}

export interface ReleaseInfo {
  tag: string
  name: string
  body: string
  url: string
  publishedAt: string
  prerelease: boolean
  draft: boolean
}

export async function fetchLatestRelease(cfg: UpdateConfig = {}): Promise<ReleaseInfo | undefined> {
  const repo = cfg.repo ?? DEFAULT_REPO
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "NEXUS-autoupdate" },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 404) return undefined
    if (!res.ok) return undefined
    const j = (await res.json()) as {
      tag_name?: string
      name?: string
      body?: string
      html_url?: string
      published_at?: string
      prerelease?: boolean
      draft?: boolean
    }
    if (!j.tag_name) return undefined
    return {
      tag: j.tag_name,
      name: j.name ?? j.tag_name,
      body: j.body ?? "",
      url: j.html_url ?? "",
      publishedAt: j.published_at ?? "",
      prerelease: !!j.prerelease,
      draft: !!j.draft,
    }
  } catch {
    return undefined
  }
}

export function readLocalVersion(cwd?: string): string {
  const root = cwd ?? process.cwd()
  // Prefer the VERSION file (one-liner, no JSON parse).
  const versionFile = path.join(root, "VERSION")
  if (fs.existsSync(versionFile)) return fs.readFileSync(versionFile, "utf8").trim()
  // Fallback: package.json.
  const pkg = path.join(root, "package.json")
  if (fs.existsSync(pkg)) {
    try {
      const j = JSON.parse(fs.readFileSync(pkg, "utf8")) as { version?: string }
      if (j.version) return j.version
    } catch {
      // ignore
    }
  }
  return "unknown"
}

/** Compare two semver-ish strings. Returns > 0 if a > b, < 0 if a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = stripVer(a).split(".").map((s) => Number.parseInt(s, 10) || 0)
  const pb = stripVer(b).split(".").map((s) => Number.parseInt(s, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const av = pa[i] ?? 0
    const bv = pb[i] ?? 0
    if (av !== bv) return av - bv
  }
  return 0
}

function stripVer(v: string): string {
  return v.replace(/^v/, "").replace(/-.*$/, "")
}

export function formatUpdateReport(local: string, latest: ReleaseInfo | undefined): string {
  if (!latest) return `local: ${local} · latest: <could not reach GitHub>`
  const cmp = compareVersions(stripVer(latest.tag), stripVer(local))
  const cmpText = cmp > 0 ? `${local} → ${latest.tag} (update available)` : cmp === 0 ? `${local} (up to date)` : `${local} (ahead of ${latest.tag})`
  const lines = [
    `NEXUS update check`,
    `  local:    ${local}`,
    `  latest:   ${latest.tag}  (${cmpText})`,
    `  release:  ${latest.name}`,
    `  date:     ${latest.publishedAt}`,
    `  url:      ${latest.url}`,
  ]
  if (latest.prerelease) lines.push(`  flag:     pre-release`)
  if (cmp > 0) {
    lines.push("")
    lines.push(`Run 'nexus update apply' to pull.`)
  }
  if (latest.body) {
    const trimmed = latest.body.split("\n").slice(0, 8).join("\n")
    lines.push("")
    lines.push("Release notes (first 8 lines):")
    for (const ln of trimmed.split("\n")) lines.push(`  ${ln}`)
  }
  return lines.join("\n")
}

/** Apply the update by running `git pull` in the repo cwd. Requires explicit user approval. */
export async function applyUpdate(cfg: UpdateConfig = {}): Promise<{ ok: boolean; output: string }> {
  const cwd = cfg.cwd ?? process.cwd()
  try {
    const { stdout, stderr } = await execFileAsync("git", ["pull", "--ff-only"], { cwd, timeout: 60_000 })
    return { ok: true, output: (stdout + (stderr ? "\n" + stderr : "")).trim() }
  } catch (e) {
    return { ok: false, output: (e as Error).message }
  }
}
