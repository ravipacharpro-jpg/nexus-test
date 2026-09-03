import {
  buildDeveloperBugReport,
  chooseIncidentPollIntervalMs,
  ingestIncidentLog,
  type DeveloperBugReport,
  type DeviceHealthSnapshot,
  type IncidentReport,
  type IncidentResourcePolicy,
  TERMUX_SAFE_INCIDENT_POLICY,
} from "./incident-response"

export type IncidentWatcherOptions = {
  policy?: IncidentResourcePolicy
  device: DeviceHealthSnapshot
  onReport?: (report: IncidentReport) => void | Promise<void>
  onDeveloperReport?: (report: DeveloperBugReport) => void | Promise<void>
  developerReportConsent?: Parameters<typeof buildDeveloperBugReport>[2]
  version?: string
}

export type IncidentWatcher = {
  readonly intervalMs: number
  ingest: (chunk: string) => Promise<IncidentReport>
  ingestStream: (chunks: AsyncIterable<string | Uint8Array>) => Promise<IncidentReport>
  stop: () => void
}

export function createIncidentWatcher(options: IncidentWatcherOptions): IncidentWatcher {
  let stopped = false
  const policy = options.policy ?? TERMUX_SAFE_INCIDENT_POLICY
  const intervalMs = chooseIncidentPollIntervalMs(options.device)

  return {
    intervalMs,
    async ingestStream(chunks) {
      let combined = ""
      for await (const chunk of chunks) {
        if (stopped) throw new Error("Incident watcher is stopped")
        const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
        combined += text
        if (combined.length >= policy.maxBytes) break
      }
      return this.ingest(combined)
    },
    async ingest(chunk) {
      if (stopped) throw new Error("Incident watcher is stopped")
      const report = ingestIncidentLog(chunk, policy)
      await options.onReport?.(report)
      if (options.developerReportConsent) {
        const developerReport = buildDeveloperBugReport(
          report,
          options.device,
          options.developerReportConsent,
          options.version,
        )
        if (developerReport) await options.onDeveloperReport?.(developerReport)
      }
      return report
    },
    stop() {
      stopped = true
    },
  }
}

export * as IncidentWatcher from "./incident-watcher"
