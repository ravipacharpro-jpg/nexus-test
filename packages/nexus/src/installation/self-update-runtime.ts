import { access, chmod, copyFile, mkdir, rename, rm } from "node:fs/promises"
import { dirname } from "node:path"
import type { SelfUpdatePlan } from "./self-update"

export type SelfUpdateRuntimeResult = {
  activated: boolean
  rolledBack: boolean
  installPath: string
  backupPath: string
  message: string
}

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function applyPreparedSelfUpdate(input: {
  plan: SelfUpdatePlan
  installPath: string
  preparedBinaryPath: string
  healthCheck: (installPath: string) => Promise<boolean>
  signal?: AbortSignal
}): Promise<SelfUpdateRuntimeResult> {
  if (!input.plan.available || input.plan.activation !== "atomic_after_health_check") {
    throw new Error("Self-update plan is not active")
  }
  input.signal?.throwIfAborted()
  const installPath = input.installPath
  const backupPath = input.plan.backupPath ?? `${installPath}.previous`
  await mkdir(dirname(installPath), { recursive: true })
  if (!(await exists(input.preparedBinaryPath))) throw new Error("Prepared self-update binary does not exist")
  const hadExisting = await exists(installPath)
  if (await exists(backupPath)) await rm(backupPath, { force: true })
  if (hadExisting) await rename(installPath, backupPath)
  try {
    input.signal?.throwIfAborted()
    await copyFile(input.preparedBinaryPath, installPath)
    await chmod(installPath, 0o755)
    input.signal?.throwIfAborted()
    if (!(await input.healthCheck(installPath))) throw new Error("Self-update health check failed")
    return {
      activated: true,
      rolledBack: false,
      installPath,
      backupPath,
      message: "Self-update activated after health verification.",
    }
  } catch (error) {
    await rm(installPath, { force: true })
    if (hadExisting && (await exists(backupPath))) await rename(backupPath, installPath)
    return {
      activated: false,
      rolledBack: hadExisting,
      installPath,
      backupPath,
      message: `Self-update failed and was ${hadExisting ? "rolled back" : "left inactive"}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export * as SelfUpdateRuntime from "./self-update-runtime"
