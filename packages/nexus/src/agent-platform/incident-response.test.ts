import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  buildDeveloperBugReport,
  chooseIncidentPollIntervalMs,
  ingestIncidentLog,
  isResourceConstrainedDevice,
  redactSensitiveText,
  summarizeIncidentReport,
  TERMUX_SAFE_INCIDENT_POLICY,
} from "./incident-response"

describe("incident response", () => {
  test("redacts API keys, bearer tokens, JWTs, and verification codes", () => {
    const result = redactSensitiveText(
      "api_key=abc123 Authorization: Bearer secret-token password: hunter2 jwt eyJabc.def.ghi otp: 123456",
    )
    expect(result.text).not.toContain("abc123")
    expect(result.text).not.toContain("secret-token")
    expect(result.text).not.toContain("hunter2")
    expect(result.text).not.toContain("123456")
    expect(result.redactions).toBeGreaterThanOrEqual(4)
  })

  test("classifies incidents and creates stable fingerprints", () => {
    const first = ingestIncidentLog("2026-08-28T10:00:00Z [android] adb install failed: OOM")
    const second = ingestIncidentLog("2026-08-28T11:00:00Z [android] adb install failed: OOM")
    expect(first.incidents[0]?.severity).toBe("critical")
    expect(first.incidents[0]?.source).toBe("android")
    expect(first.incidents[0]?.fingerprint).toBe(second.incidents[0]?.fingerprint)
    expect(summarizeIncidentReport(first)).toContain("critical=1")
  })

  test("adapts polling for Termux and constrained devices", () => {
    const termux = {
      platform: "android" as const,
      termux: true,
      architecture: "arm64",
      adbConnected: false,
      nativeCapabilities: [],
    }
    expect(isResourceConstrainedDevice(termux)).toBe(true)
    expect(chooseIncidentPollIntervalMs(termux)).toBe(30_000)
    expect(
      chooseIncidentPollIntervalMs({ ...termux, termux: false, platform: "linux", memoryAvailableBytes: 2 ** 30 }),
    ).toBe(5_000)
  })

  test("requires explicit consent and emits only anonymized report fields", () => {
    const incident = ingestIncidentLog("[worker] api_key=private-token failed")
    const snapshot = {
      platform: "android" as const,
      termux: true,
      architecture: "arm64",
      memoryAvailableBytes: 100,
      adbConnected: false,
      nativeCapabilities: ["adb"],
    }
    expect(
      buildDeveloperBugReport(
        incident,
        snapshot,
        { enabled: false, includeDeviceMetrics: true, includeIncidentFingerprints: true, includeVersion: true },
        "1.0.0",
      ),
    ).toBeUndefined()
    const result = buildDeveloperBugReport(incident, snapshot, {
      enabled: true,
      includeDeviceMetrics: true,
      includeIncidentFingerprints: true,
      includeVersion: false,
    })!
    expect(JSON.stringify(result)).not.toContain("private-token")
    expect(result.version).toBeUndefined()
    expect(result.device?.termux).toBe(true)
  })

  test("exports an anonymized report atomically for offline developer sharing", async () => {
    const report = buildDeveloperBugReport(ingestIncidentLog("[worker] api_key=private-token failed"), undefined, {
      enabled: true,
      includeDeviceMetrics: false,
      includeIncidentFingerprints: true,
      includeVersion: false,
    })!
    const directory = await mkdtemp(join(tmpdir(), "nexus-incident-report-"))
    const path = join(directory, "report.json")
    const { saveDeveloperBugReport } = await import("./incident-response")
    await saveDeveloperBugReport(path, report)
    const saved = await readFile(path, "utf8")
    expect(saved).not.toContain("private-token")
    expect(JSON.parse(saved).product).toBe("nexus")
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  test("bounds bytes, lines, line length, and incident count", () => {
    const report = ingestIncidentLog("error one\nerror two\n" + "x".repeat(100), {
      ...TERMUX_SAFE_INCIDENT_POLICY,
      maxBytes: 22,
      maxLines: 2,
      maxLineLength: 8,
      maxIncidents: 1,
    })
    expect(report.bytesRead).toBeLessThanOrEqual(22)
    expect(report.linesRead).toBeLessThanOrEqual(2)
    expect(report.incidents).toHaveLength(1)
    expect(report.incidents[0]?.message.length).toBeLessThanOrEqual(8)
    expect(report.truncated).toBe(true)
  })
})
