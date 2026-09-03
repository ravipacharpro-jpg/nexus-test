export type SelfUpdateMethod = "curl" | "npm" | "yarn" | "pnpm" | "bun" | "brew" | "scoop" | "choco"

export type SelfUpdateInput = {
  currentVersion: string
  latestVersion: string
  method: SelfUpdateMethod
  platform?: NodeJS.Platform
  architecture?: string
  installPath?: string
}

export type SelfUpdatePlan = {
  available: boolean
  currentVersion: string
  latestVersion: string
  method: SelfUpdateMethod
  platform: NodeJS.Platform
  architecture: string
  reason: string
  steps: string[]
  backupPath?: string
  activation: "not_required" | "atomic_after_health_check"
}

function versionParts(version: string): number[] | undefined {
  const clean = version.trim().replace(/^v/i, "").split("-")[0]
  if (!/^\d+(\.\d+){0,2}$/.test(clean)) return undefined
  return clean.split(".").map(Number)
}

function compareVersions(current: number[], latest: number[]) {
  for (let index = 0; index < 3; index += 1) {
    const left = current[index] ?? 0
    const right = latest[index] ?? 0
    if (left !== right) return left < right ? -1 : 1
  }
  return 0
}

export function planSelfUpdate(input: SelfUpdateInput): SelfUpdatePlan {
  const current = versionParts(input.currentVersion)
  const latest = versionParts(input.latestVersion)
  if (!current || !latest) throw new Error("Self-update versions must use numeric semver such as 1.2.3")
  const platform = input.platform ?? process.platform
  const architecture = input.architecture ?? process.arch
  const available = compareVersions(current, latest) < 0
  const backupPath = input.installPath ? `${input.installPath}.previous` : undefined
  return {
    available,
    currentVersion: input.currentVersion,
    latestVersion: input.latestVersion,
    method: input.method,
    platform,
    architecture,
    reason: available
      ? `Version ${input.latestVersion} is newer than ${input.currentVersion}.`
      : "Installed version is current or newer.",
    steps: available
      ? [
          "Verify release metadata and platform/architecture compatibility.",
          ...(backupPath
            ? [`Copy the active installation to ${backupPath} before replacement.`]
            : ["Create a backup of the active installation before replacement."]),
          "Download or invoke the native package-manager update using fixed arguments.",
          "Activate the new installation atomically only after a version and health check pass.",
          "Restore the backup if activation or health verification fails.",
        ]
      : [],
    ...(backupPath ? { backupPath } : {}),
    activation: available ? "atomic_after_health_check" : "not_required",
  }
}

export function isSelfUpdateSafeToAutoPrepare(plan: SelfUpdatePlan): boolean {
  return plan.available && plan.activation === "atomic_after_health_check" && plan.steps.length >= 4
}

export * as SelfUpdate from "./self-update"
