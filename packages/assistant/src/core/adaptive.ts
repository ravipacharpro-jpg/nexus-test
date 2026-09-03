import os from "os"
import path from "path"
import type { EnvironmentConfig } from "./types"

const TERMUX_PREFIX = "/data/data/com.termux/files"

export function isTermux(): boolean {
  return !!process.env.TERMUX_VERSION || !!process.env.PREFIX?.includes("com.termux")
}

export function detectEnvironment(): EnvironmentConfig {
  if (isTermux()) {
    return {
      type: "termux",
      maxPlugins: 2,
      idleTimeoutMs: 2 * 60 * 1000,
      preferCloudAI: true,
      disabledPlugins: [],
      parallelJobs: 1,
      tempDir: process.env.TMPDIR || path.join(TERMUX_PREFIX, "usr", "tmp"),
    }
  }

  const totalMem = os.totalmem()
  const cpus = os.cpus().length

  if (totalMem < 4 * 1024 * 1024 * 1024) {
    return {
      type: "low-end-pc",
      maxPlugins: 3,
      idleTimeoutMs: 3 * 60 * 1000,
      preferCloudAI: true,
      disabledPlugins: [],
      parallelJobs: Math.min(2, cpus),
      tempDir: os.tmpdir(),
    }
  }

  return {
    type: "pc",
    maxPlugins: 6,
    idleTimeoutMs: 5 * 60 * 1000,
    preferCloudAI: false,
    disabledPlugins: [],
    parallelJobs: cpus,
    tempDir: os.tmpdir(),
  }
}

export * as AdaptiveConfig from "./adaptive"
