import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export type RuntimeEnvironment = "termux" | "proot" | "andronix" | "userland" | "wsl" | "macos" | "linux" | "windows"

export type RuntimeProbe = {
  env: Record<string, string | undefined>
  platform: NodeJS.Platform
  release: string
  home: string
  exists: (path: string) => boolean
}

const systemProbe = (): RuntimeProbe => ({
  env: process.env,
  platform: process.platform,
  release: os.release(),
  home: process.env.HOME ?? os.homedir(),
  exists: (path) => {
    try {
      return fs.existsSync(path)
    } catch {
      return false
    }
  },
})

const hasEnvironmentMarker = (env: RuntimeProbe["env"], markers: string[]) => markers.some((marker) => Boolean(env[marker]))

export const detectRuntimeEnvironment = (probe: RuntimeProbe = systemProbe()): RuntimeEnvironment => {
  const prefix = probe.env.PREFIX?.toLowerCase() ?? ""
  const home = probe.home.toLowerCase()

  // Android container runtimes may inherit a Termux PREFIX. Their explicit
  // markers must win so callers do not attempt native-Termux-only commands.
  if (hasEnvironmentMarker(probe.env, ["ANDRONIX_APP", "ANDRONIX_HOME", "ANDRONIX"]) || probe.exists("/sdcard/Andronix")) return "andronix"
  if (hasEnvironmentMarker(probe.env, ["USERLAND_APP", "USERLAND", "USERLAND_PATH"]) || probe.exists("/home/userland")) return "userland"
  if (hasEnvironmentMarker(probe.env, ["PROOT_DISTRO", "PROOT_NO_SECCOMP", "PROOT_LOADER"]) || probe.exists("/.proot")) return "proot"
  if (probe.env.TERMUX_VERSION || prefix.includes("com.termux") || home.includes("com.termux")) return "termux"
  if (probe.env.WSL_DISTRO_NAME || /microsoft/i.test(probe.release)) return "wsl"
  if (probe.platform === "darwin") return "macos"
  if (probe.platform === "win32") return "windows"
  return "linux"
}

export const isNativeTermux = (probe?: RuntimeProbe) => detectRuntimeEnvironment(probe) === "termux"

/**
 * Android's `/tmp` may be present but not writable from the Termux app
 * sandbox. Native Termux always has a writable `${PREFIX}/tmp`; container
 * runtimes deliberately keep their own normal temporary-directory behavior.
 */
export const runtimeTempDirectory = (probe: RuntimeProbe = systemProbe()): string => {
  if (isNativeTermux(probe)) {
    return path.join(probe.env.PREFIX ?? "/data/data/com.termux/files/usr", "tmp")
  }
  return probe.env.TMPDIR || os.tmpdir()
}
