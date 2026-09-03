import { mkdir, rm, statfs, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Argv } from "yargs"
import { cmd } from "./cmd"

export type CheckState = "ok" | "fail" | "skip"

export type CheckOutcome = {
  state: CheckState
  detail: string
  hint?: string
}

export type CheckResult = CheckOutcome & {
  name: string
}

export type Check = {
  name: string
  run: () => Promise<CheckOutcome>
}

export type DoctorIO = {
  getEnv: (key: string) => string | undefined
  platform: () => NodeJS.Platform
  homeDir: () => string
  exists: (path: string) => Promise<boolean>
  readTextFile: (path: string) => Promise<string>
  commandExists: (command: string) => Promise<boolean>
  runHelp: (command: string) => Promise<boolean | null>
  ensureWritableDir: (path: string) => Promise<boolean>
  freeBytes: (path: string) => Promise<number | undefined>
}

export type RuntimeKind = "termux-native" | "termux-proot" | "linux" | "macos" | "windows" | "other"

export type RuntimeDetection = {
  kind: RuntimeKind
  label: string
}

export type QueueSummary = {
  valid: boolean
  pending: number
  failed: number
  problem?: string
}

export type ProviderCount = {
  count: number
  filesRead: number
}

export const MIN_FREE_BYTES = 500 * 1024 * 1024

export function detectRuntime(
  getEnv: (key: string) => string | undefined,
  platform: string,
): RuntimeDetection {
  const prefix = getEnv("PREFIX") ?? ""
  if (getEnv("TERMUX_VERSION") || prefix.includes("com.termux")) return { kind: "termux-native", label: "native Termux" }
  if (prefix.includes("proot-distro") || prefix.includes("rootfs"))
    return { kind: "termux-proot", label: "PRoot Linux distribution" }
  if (platform === "darwin") return { kind: "macos", label: "macOS" }
  if (platform === "win32") return { kind: "windows", label: "Windows" }
  if (platform === "linux") return { kind: "linux", label: "Linux" }
  return { kind: "other", label: platform }
}

export function summarizeQueue(text: string): QueueSummary {
  const parsed = parseJson(text)
  if (parsed === undefined) return { valid: false, pending: 0, failed: 0, problem: "queue.json is not valid JSON" }
  const records = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.records)
      ? parsed.records
      : null
  if (records === null) return { valid: false, pending: 0, failed: 0, problem: "queue.json has an unrecognized structure" }
  const pending = records.filter((record) => recordState(record) === "pending").length
  const failed = records.filter((record) => recordState(record) === "failed").length
  return { valid: true, pending, failed }
}

export function countProviders(texts: Array<string | undefined>): ProviderCount {
  const ids = new Set<string>()
  let filesRead = 0
  for (const text of texts) {
    const parsed = parseJson(text ?? "")
    if (!isRecord(parsed)) continue
    filesRead += 1
    for (const key of Object.keys(parsed)) ids.add(key)
  }
  return { count: ids.size, filesRead }
}

export function resolveExitCode(results: CheckResult[], strict: boolean): 0 | 1 {
  if (!strict) return 0
  return results.some((result) => result.state === "fail") ? 1 : 0
}

export function renderReport(results: CheckResult[]): string {
  const width = Math.max(0, ...results.map((result) => result.name.length))
  const lines = results.map(
    (result) => `${marker(result.state).padEnd(7)}${result.name.padEnd(width)} — ${result.detail}`,
  )
  const hints = [...new Set(results.flatMap((result) => (result.state !== "ok" && result.hint ? [result.hint] : [])))]
  if (hints.length > 0) lines.push("", "Fixes:", ...hints.map((hint) => `  • ${hint}`))
  return ["NEXUS doctor", ...lines].join("\n")
}

export async function runChecks(checks: Check[]): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  for (const check of checks) {
    const outcome = await check.run()
    results.push({ ...outcome, name: check.name })
  }
  return results
}

export function createChecks(io: DoctorIO): Check[] {
  const native = isNativeTermux(io.getEnv)
  const paths = resolvePaths(io.homeDir(), io.getEnv("PREFIX"))
  return [
    { name: "Runtime environment", run: () => runtimeOutcome(io) },
    { name: "termux-api package", run: () => termuxApiPackageOutcome(io, native) },
    { name: "Termux:API app", run: () => termuxApiAppOutcome(io, native) },
    { name: "Wake-lock helper", run: () => wakeLockOutcome(io, native) },
    { name: "Boot autostart directory", run: () => bootOutcome(io, native, paths.bootDir) },
    { name: "Shared storage access", run: () => storageOutcome(io, native, paths.storageDir) },
    { name: "Task queue integrity", run: () => queueOutcome(io, paths.queueFile) },
    { name: "Vault and config", run: () => vaultOutcome(io, paths.nexusDir, [paths.authFile, paths.vaultFile]) },
    { name: "Disk space on home", run: () => diskOutcome(io, io.homeDir()) },
    { name: "Runtime tmp writable", run: () => tmpOutcome(io, paths.tmpDir) },
  ]
}

export function createDefaultIO(): DoctorIO {
  const home = homedir()
  return {
    getEnv: (key) => process.env[key],
    platform: () => process.platform,
    homeDir: () => home,
    exists: (path) => Bun.file(path).exists(),
    readTextFile: (path) => Bun.file(path).text(),
    commandExists: (command) => Bun.$`which ${command}`.nothrow().quiet().then((result) => result.exitCode === 0),
    runHelp: (command) =>
      withinMs(Bun.$`${command} --help`.nothrow().quiet().then((result) => result.exitCode === 0), HELP_TIMEOUT_MS, null),
    ensureWritableDir: probeWritable,
    freeBytes: (path) =>
      statfs(path)
        .then((stats) => stats.bavail * stats.bsize)
        .catch(() => undefined),
  }
}

export const DoctorCommand = cmd({
  command: "doctor",
  describe: "one-command health check for Termux and desktop installs",
  builder: (yargs: Argv) =>
    yargs
      .option("strict", { type: "boolean", default: false, describe: "exit 1 when any check fails" })
      .option("json", { type: "boolean", default: false, describe: "print machine-readable results" }),
  handler: async (args: { json?: boolean; strict?: boolean }) => {
    const results = await runChecks(createChecks(createDefaultIO()))
    if (args.json) {
      console.log(JSON.stringify(results, null, 2))
      return
    }
    console.log(renderReport(results))
    process.exitCode = resolveExitCode(results, args.strict === true)
  },
})

const HELP_TIMEOUT_MS = 5000

type DoctorPaths = {
  nexusDir: string
  queueFile: string
  authFile: string
  vaultFile: string
  bootDir: string
  storageDir: string
  tmpDir: string
}

function resolvePaths(home: string, prefix?: string): DoctorPaths {
  const nexusDir = join(home, ".nexus")
  return {
    nexusDir,
    queueFile: join(nexusDir, "queue.json"),
    authFile: join(nexusDir, "auth.json"),
    vaultFile: join(nexusDir, "api-vault.json"),
    bootDir: join(home, ".termux", "boot"),
    storageDir: join(home, "storage"),
    tmpDir: prefix ? join(prefix, "tmp", "nexus") : "/tmp/nexus",
  }
}

async function runtimeOutcome(io: DoctorIO): Promise<CheckOutcome> {
  const detected = detectRuntime(io.getEnv, io.platform())
  return ok(`${detected.label} (informational)`)
}

async function termuxApiPackageOutcome(io: DoctorIO, native: boolean): Promise<CheckOutcome> {
  if (!native) return skipped("not native Termux")
  const found: string[] = []
  for (const command of ["termux-battery-status", "termux-toast"]) {
    if (await io.commandExists(command)) found.push(command)
  }
  if (found.length === 0) return failed("no termux-api commands on PATH", "Run pkg i termux-api inside Termux.")
  return ok(`${found.join(", ")} available`)
}

async function termuxApiAppOutcome(io: DoctorIO, native: boolean): Promise<CheckOutcome> {
  const hint = "Install the Termux:API Android app and run pkg i termux-api."
  if (!native) return skipped("not native Termux")
  if (!(await io.commandExists("termux-battery-status"))) return skipped("termux-battery-status not installed", hint)
  const responded = await io.runHelp("termux-battery-status")
  if (responded === null) return skipped("--help probe timed out", hint)
  return responded ? ok("Termux:API app responded to probe") : failed("Termux:API app did not respond to probe", hint)
}

async function wakeLockOutcome(io: DoctorIO, native: boolean): Promise<CheckOutcome> {
  if (!native) return skipped("not native Termux")
  const available = await io.commandExists("termux-wake-lock")
  return available
    ? ok("termux-wake-lock available")
    : failed("termux-wake-lock not found", "pkg i termux-api provides termux-wake-lock.")
}

async function bootOutcome(io: DoctorIO, native: boolean, bootDir: string): Promise<CheckOutcome> {
  if (!native) return skipped("not native Termux")
  const exists = await io.exists(bootDir)
  return exists
    ? ok(bootDir)
    : failed(`${bootDir} missing`, "Install the Termux:Boot app; autostart scripts go in ~/.termux/boot.")
}

async function storageOutcome(io: DoctorIO, native: boolean, storageDir: string): Promise<CheckOutcome> {
  if (!native) return skipped("not native Termux")
  const exists = await io.exists(storageDir)
  return exists ? ok(storageDir) : failed(`${storageDir} missing`, "Run termux-setup-storage to grant shared storage access.")
}

async function queueOutcome(io: DoctorIO, queueFile: string): Promise<CheckOutcome> {
  if (!(await io.exists(queueFile))) return ok("no queue.json recorded")
  const text = await io.readTextFile(queueFile).catch(() => undefined)
  if (text === undefined) return failed(`could not read ${queueFile}`, "Check permissions on ~/.nexus/queue.json.")
  const summary = summarizeQueue(text)
  if (!summary.valid) return failed(summary.problem ?? "queue.json is corrupt", "Repair or remove ~/.nexus/queue.json.")
  return ok(`valid JSON · ${summary.pending} pending · ${summary.failed} failed`)
}

async function vaultOutcome(io: DoctorIO, nexusDir: string, providerFiles: string[]): Promise<CheckOutcome> {
  if (!(await io.ensureWritableDir(nexusDir)))
    return failed(`${nexusDir} is missing or not writable`, "Create ~/.nexus and grant write access.")
  const texts = await Promise.all(providerFiles.map((file) => readIfPresent(io, file)))
  const providers = countProviders(texts)
  const detail = `${providers.count} configured provider(s)`
  return providers.count > 0 ? ok(detail) : failed(detail, "Run nexus providers login to configure at least one provider.")
}

async function diskOutcome(io: DoctorIO, home: string): Promise<CheckOutcome> {
  const free = await io.freeBytes(home)
  if (free === undefined) return skipped("disk usage unavailable")
  const detail = `${formatBytes(free)} free on ${home}`
  return free < MIN_FREE_BYTES ? failed(detail, "Free at least 500 MB on the home volume.") : ok(detail)
}

async function tmpOutcome(io: DoctorIO, tmpDir: string): Promise<CheckOutcome> {
  const writable = await io.ensureWritableDir(tmpDir)
  return writable
    ? ok(tmpDir)
    : failed(`${tmpDir} could not be created`, `Create ${tmpDir} manually and check volume permissions.`)
}

function isNativeTermux(getEnv: (key: string) => string | undefined): boolean {
  return Boolean(getEnv("TERMUX_VERSION") || getEnv("PREFIX")?.includes("com.termux"))
}

function ok(detail: string): CheckOutcome {
  return { state: "ok", detail }
}

function failed(detail: string, hint?: string): CheckOutcome {
  return { state: "fail", detail, hint }
}

function skipped(detail: string, hint?: string): CheckOutcome {
  return { state: "skip", detail, hint }
}

function marker(state: CheckState): string {
  return state === "ok" ? "✓" : state === "fail" ? "✗" : "[skip]"
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function recordState(record: unknown): unknown {
  if (!isRecord(record)) return undefined
  return record.state ?? record.status
}

async function readIfPresent(io: DoctorIO, path: string): Promise<string | undefined> {
  if (!(await io.exists(path))) return undefined
  return io.readTextFile(path).catch(() => undefined)
}

async function probeWritable(dir: string): Promise<boolean> {
  const created = await mkdir(dir, { recursive: true }).then(() => true).catch(() => false)
  if (!created) return false
  const probe = join(dir, `.doctor-${process.pid}-${Date.now()}`)
  return writeFile(probe, "ok")
    .then(() => rm(probe, { force: true }))
    .then(() => true)
    .catch(() => false)
}

function withinMs<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Legacy adapter still consumed by onboard.ts: maps the current check report
 * onto the original {storage, deviceGuard} shape without exposing secrets.
 */
export async function collectDoctorReport() {
  const results = await runChecks(createChecks(createDefaultIO()))
  const state = (name: string) => results.find((result) => result.name === name)?.state
  const writable = ["Shared storage access", "Vault and config"].every((name) => state(name) === "ok")
  const critical = ["Runtime environment", "Task queue integrity", "Disk space on home"].filter(
    (name) => state(name) === "fail",
  ).length
  return {
    storage: { writable },
    deviceGuard: {
      level: critical > 1 ? ("blocked" as const) : critical === 1 ? ("warn" as const) : ("ok" as const),
    },
  }
}

export * as Doctor from "./doctor"
