import path from "path"
import os from "os"
import { Style, Icon } from "../core/style"
import type { NexusPlugin, PluginContext } from "../core/types"

const EOL = "\n"

const TERMUX_PROPERTIES = path.join(os.homedir(), ".termux", "termux.properties")
const MANAGED_BEGIN = "# BEGIN NEXUS MANAGED"
const MANAGED_END = "# END NEXUS MANAGED"

function hasTermuxApi(): boolean {
  return !!process.env.TERMUX_VERSION || !!process.env.PREFIX?.includes("com.termux")
}

async function termuxApi(command: string, args: string[]): Promise<number> {
  if (!hasTermuxApi()) {
    process.stderr.write(`${Icon.fail} Not running inside Termux${EOL}`)
    return 1
  }
  try {
    const proc = Bun.spawn(["termux-" + command, ...args], { stdout: "inherit", stderr: "inherit" })
    return await proc.exited
  } catch {
    process.stderr.write(`${Icon.fail} 'termux-${command}' not available${EOL}`)
    process.stderr.write(`${Style.TEXT_DIM}Install Termux:API app + run: pkg install termux-api${Style.TEXT_NORMAL}${EOL}`)
    return 1
  }
}

async function notify(ctx: PluginContext): Promise<number | void> {
  const title = ctx.args[0] ?? "NEXUS"
  const content = ctx.args.slice(1).join(" ")
  return termuxApi("notification", ["--title", title, "--content", content])
}

async function toast(ctx: PluginContext): Promise<number | void> {
  const text = ctx.args.join(" ") || "NEXUS"
  return termuxApi("toast", [text])
}

async function battery(ctx: PluginContext): Promise<number | void> {
  if (!hasTermuxApi()) {
    ctx.err("Not running inside Termux")
    return 1
  }
  let raw = ""
  try {
    const proc = Bun.spawn(["termux-battery-status"], { stdout: "pipe", stderr: "ignore" })
    await proc.exited
    raw = await new Response(proc.stdout).text()
  } catch {
    raw = ""
  }
  if (!raw.trim()) {
    ctx.err("termux-battery-status unavailable — install Termux:API app + pkg install termux-api")
    return 1
  }
  try {
    const status = JSON.parse(raw)
    ctx.out(`${Icon.info} Battery: ${status.percentage}% (${status.status}) health=${status.health}`)
  } catch {
    ctx.out(raw.trim())
  }
}

async function clipboard(ctx: PluginContext): Promise<number | void> {
  if (ctx.args[0] === "set") {
    return termuxApi("clipboard-set", [ctx.args.slice(1).join(" ")])
  }
  return termuxApi("clipboard-get", [])
}

async function location(ctx: PluginContext): Promise<number | void> {
  return termuxApi("location", [])
}

async function apkAnalyze(ctx: PluginContext): Promise<number | void> {
  const file = ctx.args[0]
  if (!file) {
    ctx.err("Usage: nexus termux apk:analyze <app.apk>")
    return 1
  }

  const resolved = path.resolve(ctx.cwd, file)
  const blob = Bun.file(resolved)
  if (!(await blob.exists())) {
    ctx.err(`File not found: ${resolved}`)
    return 1
  }

  ctx.out(`${Icon.info} Analyzing ${path.basename(resolved)} (${(blob.size / 1024 / 1024).toFixed(1)} MB)`)

  const unzip = Bun.spawn(["unzip", "-o", resolved, "AndroidManifest.xml", "META-INF/MANIFEST.MF", "-d", ctx.env.tempDir + "/nexus-apk"], {
    stdout: "ignore",
    stderr: "ignore",
  })
  const exit = await unzip.exited

  if (exit !== 0) {
    ctx.err("Failed to extract APK (is 'unzip' installed? pkg install unzip)")
    return 1
  }

  const manifest = await Bun.file(ctx.env.tempDir + "/nexus-apk/META-INF/MANIFEST.MF").text().catch(() => "")
  for (const line of manifest.split("\n")) {
    if (/^(Implementation-(?:Title|Version)|Built-By|Created-By)/.test(line)) {
      ctx.out(`  ${Style.TEXT_DIM}${line.trim()}${Style.TEXT_NORMAL}`)
    }
  }

  ctx.out(`${Icon.success} Extracted manifest to ${ctx.env.tempDir}/nexus-apk`)
  ctx.out(`${Style.TEXT_DIM}Tip: use 'aapt dump badging' from android-tools for full details${Style.TEXT_NORMAL}`)
}

async function keyboard(ctx: PluginContext): Promise<number | void> {
  if (!hasTermuxApi()) {
    ctx.err("Not running inside Termux")
    return 1
  }

  await import("fs/promises").then((fs) => fs.mkdir(path.dirname(TERMUX_PROPERTIES), { recursive: true }))
  const existing = (await Bun.file(TERMUX_PROPERTIES).exists()) ? await Bun.file(TERMUX_PROPERTIES).text() : ""

  if (!ctx.flags.force && existing.includes(MANAGED_BEGIN)) {
    ctx.out(`${Icon.warn} NEXUS keyboard block already present in termux.properties (use --force to rewrite)`)
    return 0
  }

  const block = [
    MANAGED_BEGIN,
    "# Managed by NEXUS — safe to remove as a whole block",
    "extra-keys = [['ESC','/','-','HOME','UP','END','PGUP'],",
    "              ['TAB','CTRL','ALT','LEFT','DOWN','RIGHT','PGDN']]",
    MANAGED_END,
    "",
  ].join(EOL)

  const cleaned = existing.replace(new RegExp(`${MANAGED_BEGIN}[\\s\\S]*?${MANAGED_END}\\n?`, "m"), "").trimEnd()
  const backup = `${TERMUX_PROPERTIES}.bak-${Date.now()}`
  if (existing) await Bun.write(backup, existing)

  await Bun.write(TERMUX_PROPERTIES, (cleaned ? cleaned + EOL + EOL : "") + block)
  ctx.out(`${Icon.success} Updated ${TERMUX_PROPERTIES}${existing ? ` (backup: ${backup})` : ""}`)
  ctx.out(`${Style.TEXT_DIM}Run: termux-reload-settings, then fully reopen Termux${Style.TEXT_NORMAL}`)
}

async function smsRead(ctx: PluginContext): Promise<number | void> {
  const limit = typeof ctx.flags.limit === "number" ? String(ctx.flags.limit) : "10"
  if (!hasTermuxApi()) {
    ctx.err("Requires Termux:API — pkg install termux-api")
    return 1
  }
  try {
    const proc = Bun.spawn(["termux-sms-list", "-l", limit, "-t", "inbox"], { stdout: "pipe", stderr: "pipe" })
    await proc.exited
    const raw = await new Response(proc.stdout).text()
    const msgs = JSON.parse(raw) as Array<{ number?: string; text?: string; received?: string }>
    ctx.out(`${Icon.info} Last ${msgs.length} SMS:`)
    for (const msg of msgs) {
      ctx.out(`  ${Style.TEXT_DIM}${msg.number ?? "?"}${Style.TEXT_NORMAL}: ${msg.text?.slice(0, 80) ?? ""}`)
    }
    ctx.out(`${Style.TEXT_DIM}NEXUS never auto-reads OTPs into commands — HITL only.${Style.TEXT_NORMAL}`)
    return 0
  } catch {
    ctx.err("termux-sms-list unavailable — install Termux:API app + pkg install termux-api")
    return 1
  }
}

async function setup(ctx: PluginContext): Promise<number | void> {
  ctx.out(`${Icon.rocket} NEXUS Termux setup`)
  const pkgs = ["git", "curl", "tar", "unzip", "ripgrep", "fd"]
  for (const pkg of pkgs) {
    const have = Bun.which(pkg)
    ctx.out(`  ${have ? Icon.success : Icon.warn} ${pkg}${have ? "" : " — pkg install " + pkg}`)
  }
  ctx.out(`${Icon.info} Termux:API ${hasTermuxApi() ? Style.TEXT_SUCCESS + "detected" + Style.TEXT_NORMAL : Style.TEXT_WARNING + "missing — install app + pkg install termux-api" + Style.TEXT_NORMAL}`)
  await keyboard(ctx)
}

async function run(ctx: PluginContext): Promise<number | void> {
  const input = ctx.args.join(" ")
  if (/battery/i.test(input)) return battery(ctx)
  if (/notif|notify/i.test(input)) return notify(ctx)
  if (/toast/i.test(input)) return toast(ctx)
  if (/clip/i.test(input)) return clipboard(ctx)
  if (/location|gps/i.test(input)) return location(ctx)
  if (/apk/i.test(input)) return apkAnalyze(ctx)
  if (/keyboard/i.test(input)) return keyboard(ctx)
  ctx.err('Unknown termux action. Try: nexus termux run "battery"')
  return 1
}

const plugin: NexusPlugin = {
  name: "termux",
  version: "0.1.0",
  description: "Android power tools via Termux:API bridge",
  tags: ["android", "notification", "battery", "clipboard"],
  requires: {
    platform: ["linux"],
    check: () => ({
      ok: true,
      reason: undefined,
    }),
  },
  commands: [
    { name: "notify", describe: 'send an Android notification, e.g. nexus termux notify "Build Complete" --content "deployed"', usage: 'nexus termux notify <title> [content]', run: notify },
    { name: "toast", describe: "show an Android toast message", usage: "nexus termux toast <message>", run: toast },
    { name: "battery", describe: "show battery status", usage: "nexus termux battery", run: battery },
    { name: "clip:get", describe: "read the clipboard", usage: "nexus termux clip:get", run: clipboard },
    { name: "clip:set", describe: "write text to the clipboard", usage: 'nexus termux clip:set "text"', run: clipboard },
    { name: "location", describe: "get device location (requires Termux:API)", usage: "nexus termux location", run: location },
    { name: "apk:analyze", describe: "extract and inspect APK metadata", usage: "nexus termux apk:analyze app.apk", run: apkAnalyze },
    { name: "keyboard", describe: "install extra-keys row into ~/.termux/termux.properties", usage: "nexus termux keyboard [--force]", run: keyboard },
    { name: "sms:read", describe: "list recent SMS (--limit N) — display only, never auto-used", usage: "nexus termux sms:read --limit 10", run: smsRead },
    { name: "setup", describe: "check Termux environment + install keyboard extras", usage: "nexus termux setup", run: setup },
    { name: "run", describe: "natural language entry, e.g. nexus termux run \"battery check karo\"", usage: 'nexus termux run "<action>"', run },
  ],
}

export default plugin

export * as TermuxPlugin from "./termux"
