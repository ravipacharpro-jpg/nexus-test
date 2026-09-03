import { createHash } from "node:crypto"
import { mkdir, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

export type IncidentSeverity = "info" | "warning" | "error" | "critical"
export type IncidentSource = "agent" | "worker" | "process" | "browser" | "android" | "network" | "unknown"

export type IncidentResourcePolicy = {
  maxBytes: number
  maxLines: number
  maxLineLength: number
  maxIncidents: number
}

export type IncidentEvidence = {
  fingerprint: string
  severity: IncidentSeverity
  source: IncidentSource
  message: string
  context?: string
  timestamp: string
  exitCode?: number
}

export type IncidentReport = {
  incidents: IncidentEvidence[]
  truncated: boolean
  bytesRead: number
  linesRead: number
  redactions: number
}

export const TERMUX_SAFE_INCIDENT_POLICY: Readonly<IncidentResourcePolicy> = Object.freeze({
  maxBytes: 512 * 1024,
  maxLines: 2_000,
  maxLineLength: 4_096,
  maxIncidents: 100,
})

const secretPatterns: Array<[RegExp, string]> = [
  [/(Bearer\s+)[A-Za-z0-9._~+\-/]+=*/gi, "$1[REDACTED]"],
  [
    /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd|authorization)\s*[:=]\s*)(?!Bearer\s+)([^\s,;]+)/gi,
    "$1[REDACTED]",
  ],
  [/([A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,})/g, "[REDACTED_JWT]"],
  [/\b(?:otp|one[- ]time code|verification code)\s*[:=]?\s*\d{4,8}\b/gi, "verification code: [REDACTED]"],
]

export function redactSensitiveText(value: string): { text: string; redactions: number } {
  let text = value
  let redactions = 0
  for (const [pattern, replacement] of secretPatterns) {
    text = text.replace(pattern, (...args) => {
      redactions += 1
      return replacement.replace(/\$([0-9]+)/g, (_, index: string) => String(args[Number(index)] ?? ""))
    })
  }
  return { text, redactions }
}

function severityFor(line: string): IncidentSeverity {
  if (/fatal|panic|oom|out of memory|sig(bus|kill)|uncaught|unhandled/i.test(line)) return "critical"
  if (/error|failed|failure|exception|timeout|crash/i.test(line)) return "error"
  if (/warn|deprecated|retry|blocked|unavailable/i.test(line)) return "warning"
  return "info"
}

function sourceFor(line: string): IncidentSource {
  if (/android|adb|logcat|apk|aab/i.test(line)) return "android"
  if (/browser|chromium|playwright|captcha|login/i.test(line)) return "browser"
  if (/network|fetch|http|dns|socket/i.test(line)) return "network"
  if (/worker|specialist|master/i.test(line)) return "worker"
  if (/spawn|process|signal|exit code|pid/i.test(line)) return "process"
  if (/agent|nexus/i.test(line)) return "agent"
  return "unknown"
}

function fingerprint(source: IncidentSource, severity: IncidentSeverity, message: string): string {
  return createHash("sha256").update(`${source}|${severity}|${message}`).digest("hex").slice(0, 24)
}

export function ingestIncidentLog(
  input: string,
  policy: IncidentResourcePolicy = TERMUX_SAFE_INCIDENT_POLICY,
): IncidentReport {
  const bounded = input.slice(0, Math.max(0, policy.maxBytes))
  const rawLines = bounded.split(/\r?\n/)
  const lines = rawLines.slice(0, Math.max(0, policy.maxLines))
  const incidents: IncidentEvidence[] = []
  let redactions = 0

  for (const rawLine of lines) {
    const original = rawLine.slice(0, Math.max(0, policy.maxLineLength)).trim()
    if (!original || incidents.length >= policy.maxIncidents) continue
    const redacted = redactSensitiveText(original)
    redactions += redacted.redactions
    const severity = severityFor(redacted.text)
    const source = sourceFor(redacted.text)
    const timestampMatch = redacted.text.match(/^\[?(\d{4}-\d\d-\d\d[T ][^\]]+)\]?\s*/)
    const timestamp = timestampMatch?.[1] ?? new Date(0).toISOString()
    const message = redacted.text.replace(/^\[?\d{4}-\d\d-\d\d[T ][^\]]+\]?\s*/, "").slice(0, policy.maxLineLength)
    incidents.push({ fingerprint: fingerprint(source, severity, message), severity, source, message, timestamp })
  }

  return {
    incidents,
    truncated:
      input.length > bounded.length || rawLines.length > lines.length || incidents.length >= policy.maxIncidents,
    bytesRead: bounded.length,
    linesRead: lines.length,
    redactions,
  }
}

export function summarizeIncidentReport(report: IncidentReport): string {
  const counts = report.incidents.reduce<Record<IncidentSeverity, number>>(
    (result, incident) => ({ ...result, [incident.severity]: result[incident.severity] + 1 }),
    { info: 0, warning: 0, error: 0, critical: 0 },
  )
  return `incidents=${report.incidents.length} critical=${counts.critical} errors=${counts.error} warnings=${counts.warning} redactions=${report.redactions} truncated=${report.truncated}`
}

export * as IncidentResponse from "./incident-response"

export type DeviceHealthSnapshot = {
  platform: "android" | "linux" | "windows" | "macos" | "unknown"
  termux: boolean
  architecture: string
  memoryAvailableBytes?: number
  storageAvailableBytes?: number
  cpuLoadPercent?: number
  adbConnected: boolean
  nativeCapabilities: string[]
}

export type TelemetryConsent = {
  enabled: boolean
  includeDeviceMetrics: boolean
  includeIncidentFingerprints: boolean
  includeVersion: boolean
}

export type DeveloperBugReport = {
  schemaVersion: 1
  product: "nexus"
  incidents: Array<Pick<IncidentEvidence, "fingerprint" | "severity" | "source" | "message">>
  summary: string
  device?: Pick<DeviceHealthSnapshot, "platform" | "termux" | "architecture" | "adbConnected" | "nativeCapabilities">
  metrics?: Pick<DeviceHealthSnapshot, "memoryAvailableBytes" | "storageAvailableBytes" | "cpuLoadPercent">
  version?: string
}

export function isResourceConstrainedDevice(snapshot: DeviceHealthSnapshot): boolean {
  return (
    snapshot.termux ||
    (snapshot.memoryAvailableBytes !== undefined && snapshot.memoryAvailableBytes < 512 * 1024 * 1024) ||
    (snapshot.storageAvailableBytes !== undefined && snapshot.storageAvailableBytes < 256 * 1024 * 1024) ||
    (snapshot.cpuLoadPercent !== undefined && snapshot.cpuLoadPercent >= 90)
  )
}

export function buildDeveloperBugReport(
  report: IncidentReport,
  snapshot: DeviceHealthSnapshot | undefined,
  consent: TelemetryConsent,
  version?: string,
): DeveloperBugReport | undefined {
  if (!consent.enabled) return undefined
  return {
    schemaVersion: 1,
    product: "nexus",
    incidents: consent.includeIncidentFingerprints
      ? report.incidents.map(({ fingerprint, severity, source, message }) => ({
          fingerprint,
          severity,
          source,
          message,
        }))
      : [],
    summary: summarizeIncidentReport(report),
    ...(consent.includeDeviceMetrics && snapshot
      ? {
          device: {
            platform: snapshot.platform,
            termux: snapshot.termux,
            architecture: snapshot.architecture,
            adbConnected: snapshot.adbConnected,
            nativeCapabilities: snapshot.nativeCapabilities.slice(0, 32),
          },
          metrics: {
            ...(snapshot.memoryAvailableBytes !== undefined
              ? { memoryAvailableBytes: snapshot.memoryAvailableBytes }
              : {}),
            ...(snapshot.storageAvailableBytes !== undefined
              ? { storageAvailableBytes: snapshot.storageAvailableBytes }
              : {}),
            ...(snapshot.cpuLoadPercent !== undefined ? { cpuLoadPercent: snapshot.cpuLoadPercent } : {}),
          },
        }
      : {}),
    ...(consent.includeVersion && version ? { version } : {}),
  }
}

export function chooseIncidentPollIntervalMs(snapshot: DeviceHealthSnapshot): number {
  return isResourceConstrainedDevice(snapshot) ? 30_000 : 5_000
}

export function serializeDeveloperBugReport(report: DeveloperBugReport): string {
  return `${JSON.stringify(report, null, 2)}\n`
}

export async function saveDeveloperBugReport(path: string, report: DeveloperBugReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${path.split("/").pop() ?? "nexus-report"}.tmp`)
  await writeFile(temporary, serializeDeveloperBugReport(report), { mode: 0o600 })
  await rename(temporary, path)
}

export async function saveIncidentReport(path: string, report: IncidentReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${path.split("/").pop() ?? "nexus-incident"}.tmp`)
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}
