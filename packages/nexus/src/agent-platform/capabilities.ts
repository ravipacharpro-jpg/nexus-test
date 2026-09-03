import { spawnSync } from "node:child_process"

export type AgentCapabilities = {
  platform: NodeJS.Platform
  architecture: string
  termux: boolean
  git: boolean
  github: boolean
  browserHandoff: boolean
  browserHttpInspection: boolean
  browserAutomation: boolean
  webRuntime: boolean
  android: boolean
  androidDevice: boolean
  apkBuild: boolean
  packageManagers: string[]
}

function commandAvailable(command: string, platform = process.platform): boolean {
  const lookup = platform === "win32" ? "where" : "command"
  const args = platform === "win32" ? [command] : ["-v", command]
  const result = spawnSync(lookup, args, { stdio: "ignore" })
  return result.status === 0
}

function anyCommand(commands: string[], platform = process.platform): boolean {
  return commands.some((command) => commandAvailable(command, platform))
}

export function detectAgentCapabilities(env: NodeJS.ProcessEnv = process.env): AgentCapabilities {
  const termux = env.TERMUX_VERSION !== undefined || env.PREFIX?.includes("/com.termux/files/usr") === true
  const browserHandoff = termux
    ? commandAvailable("termux-open-url")
    : anyCommand(process.platform === "win32" ? ["start"] : process.platform === "darwin" ? ["open"] : ["xdg-open"])
  const browserHttpInspection = typeof globalThis.fetch === "function"
  const browserAutomation = anyCommand(["playwright", "chromium", "google-chrome", "google-chrome-stable", "chrome"])
  const packageManagers = ["bun", "npm", "pnpm", "yarn"].filter((command) => commandAvailable(command))
  const android = anyCommand(["adb", "emulator", "sdkmanager", "gradle"])
  const androidDevice =
    commandAvailable("adb") && spawnSync("adb", ["get-state"], { stdio: "ignore", timeout: 1_000 }).status === 0
  const apkBuild = commandAvailable("gradle")

  return {
    platform: process.platform,
    architecture: process.arch,
    termux,
    git: commandAvailable("git"),
    github: commandAvailable("gh"),
    browserHandoff,
    browserHttpInspection,
    browserAutomation,
    webRuntime: anyCommand(["node", "bun", "deno"]),
    android,
    androidDevice,
    apkBuild,
    packageManagers,
  }
}

export function capabilitySummary(capabilities: AgentCapabilities): string[] {
  const enabled: string[] = []
  if (capabilities.termux) enabled.push("Termux/Android shell")
  if (capabilities.git) enabled.push("Git")
  if (capabilities.github) enabled.push("GitHub CLI")
  if (capabilities.browserHandoff) enabled.push("browser handoff")
  if (capabilities.browserHttpInspection) enabled.push("safe HTTP inspection")
  if (capabilities.browserAutomation) enabled.push("browser automation")
  if (capabilities.webRuntime) enabled.push("web runtime")
  if (capabilities.android) enabled.push("Android tooling")
  if (capabilities.androidDevice) enabled.push("connected Android device")
  if (capabilities.apkBuild) enabled.push("APK build/test tooling")
  return enabled
}
