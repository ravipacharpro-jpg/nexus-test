import type { AgentCapabilities } from "./capabilities"

export type AndroidTestPlan = {
  artifact: string
  artifactType: "apk" | "aab"
  readOnlyChecks: string[]
  deviceChecks: string[]
  canRunDeviceChecks: boolean
  approvalRequired: string[]
  limitations: string[]
}

export type AndroidDeviceCommand = {
  id: "install" | "launch" | "logcat"
  command: string[]
  approvalRequired: boolean
  reason: string
}

export function planAndroidDeviceCommands(input: {
  artifact: string
  packageName: string
  androidDevice: boolean
}): AndroidDeviceCommand[] {
  const artifact = input.artifact.trim()
  if (!artifact.toLowerCase().endsWith(".apk")) throw new Error("ADB device checks require an .apk artifact")
  if (!input.packageName.trim()) throw new Error("Android package name is required for launch testing")
  if (!input.androidDevice) return []
  const packageName = input.packageName.trim()
  return [
    {
      id: "install",
      command: ["adb", "install", "-r", artifact],
      approvalRequired: true,
      reason: "Install or replace the APK on the connected Android device.",
    },
    {
      id: "launch",
      command: ["adb", "shell", "monkey", "-p", packageName, "1"],
      approvalRequired: true,
      reason: "Launch the APK and interact with device state.",
    },
    {
      id: "logcat",
      command: ["adb", "logcat", "-d", "-t", "200"],
      approvalRequired: true,
      reason: "Collect bounded device logs for redacted crash diagnosis.",
    },
  ]
}

export function planAndroidArtifactTest(input: {
  artifact: string
  capabilities: Pick<AgentCapabilities, "android" | "androidDevice" | "apkBuild">
}): AndroidTestPlan {
  const artifact = input.artifact.trim()
  const artifactType = artifact.toLowerCase().endsWith(".aab")
    ? "aab"
    : artifact.toLowerCase().endsWith(".apk")
      ? "apk"
      : undefined
  if (!artifactType) throw new Error("Android test artifact must be an .apk or .aab file")
  const readOnlyChecks = [
    "Verify artifact exists and remains inside the workspace.",
    "Inspect package metadata and signing information without exposing secrets.",
  ]
  const deviceChecks =
    artifactType === "apk"
      ? [
          "Confirm ADB device state.",
          "Install in an isolated test profile.",
          "Launch and collect bounded logcat/crash evidence.",
        ]
      : ["Validate bundle metadata; install testing requires generated APK splits or an approved bundle test service."]
  const approvalRequired =
    artifactType === "apk"
      ? ["Install or replace an app on the connected device.", "Launch the app and capture device data."]
      : ["Upload the bundle to an external test service."]
  const limitations = [
    ...(!input.capabilities.apkBuild ? ["Android build tooling is unavailable on this device."] : []),
    ...(!input.capabilities.androidDevice
      ? ["No connected Android device was detected; device checks remain checkpointed."]
      : []),
    ...(artifactType === "aab" ? ["An AAB is not directly installable with adb."] : []),
  ]
  return {
    artifact,
    artifactType,
    readOnlyChecks,
    deviceChecks,
    canRunDeviceChecks: artifactType === "apk" && input.capabilities.androidDevice,
    approvalRequired,
    limitations,
  }
}

export * as AndroidAudit from "./android-audit"
