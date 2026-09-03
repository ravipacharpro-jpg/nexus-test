import { afterEach, expect, test } from "bun:test"
import { Effect } from "effect"
import { parseAaptBadging, TermuxAPI } from "./index"

const savedTermuxVersion = process.env.TERMUX_VERSION
const savedPrefix = process.env.PREFIX

afterEach(() => {
  if (savedTermuxVersion === undefined) delete process.env.TERMUX_VERSION
  else process.env.TERMUX_VERSION = savedTermuxVersion
  if (savedPrefix === undefined) delete process.env.PREFIX
  else process.env.PREFIX = savedPrefix
})

test("Termux API fails honestly outside native Termux instead of returning placeholder data", async () => {
  delete process.env.TERMUX_VERSION
  process.env.PREFIX = "/usr/local"

  await expect(Effect.runPromise(TermuxAPI.getBatteryStatus())).rejects.toThrow("native Termux")
  await expect(Effect.runPromise(TermuxAPI.readSms())).rejects.toThrow("native Termux")
})

test("aapt badging output is mapped to real APK metadata fields", () => {
  const metadata = parseAaptBadging("package: name='com.example.nexus' versionCode='42' versionName='1.2.3'\nsdkVersion:'24'\ntargetSdkVersion:'35'\napplication-label:'NEXUS'\nlaunchable-activity: name='com.example.nexus.MainActivity'  label='NEXUS' icon=''\n")
  expect(metadata).toMatchObject({
    packageName: "com.example.nexus",
    versionCode: "42",
    versionName: "1.2.3",
    minSdkVersion: "24",
    targetSdkVersion: "35",
    applicationLabel: "NEXUS",
    launchableActivity: "com.example.nexus.MainActivity",
  })
})
