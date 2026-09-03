import path from "path"
import { Style, Icon, ok, bad } from "../core/style"
import type { NexusPlugin, PluginContext } from "../core/types"

const EOL = "\n"

interface PermissionRisk {
  permission: string
  risk: "critical" | "high" | "medium" | "low"
  why: string
}

const DANGEROUS_PERMISSIONS: Array<[RegExp, PermissionRisk["risk"], string]> = [
  [/READ_SMS|RECEIVE_SMS|SEND_SMS/i, "critical", "SMS access — OTP theft ya spyware ka classic sign"],
  [/READ_CALL_LOG|PROCESS_OUTGOING_CALLS/i, "critical", "Call history/logs — stalking ya data theft"],
  [/RECORD_AUDIO|CAMERA(?!.*max)/i, "high", "Mic/camera access — legit apps me bhi hota hai, context check karo"],
  [/READ_CONTACTS|WRITE_CONTACTS/i, "medium", "Contacts access"],
  [/ACCESS_FINE_LOCATION/i, "medium", "Location tracking"],
  [/REQUEST_INSTALL_PACKAGES/i, "high", "Doosre APK install kar sakta hai — dropper behaviour"],
  [/SYSTEM_ALERT_WINDOW/i, "medium", "Overlay draw — phishing overlays ke liye use hota hai"],
  [/RECEIVE_BOOT_COMPLETED/i, "low", "Boot pe start — persistence"],
]

const TRACKER_SIGNATURES = [
  "com.facebook.",
  "com.appsflyer",
  "io.branch.",
  "com.adjust.",
  "com.google.android.gms.ads",
  "com.umeng",
  "com.yandex.",
]

const SUSPICIOUS_STRINGS: Array<[RegExp, string]> = [
  [/"Ld?alvik\/system[^"]*exec|system\("cmd|Runtime\.getRuntime\(\)\.exec/i, "Native/exec calls"],
  [/frida|xposed|substrate/i, "Hooking framework references (anti-cheat ya cheat engine)"],
  [/libil2cpp|global-metadata\.dat/, "Unity IL2CPP hooks (mod menu engines common)"],
  [/\/proc\/\/.*mem|mprotect|ptrace/i, "Memory injection / process manipulation"],
]

async function extractApk(ctx: PluginContext, apkPath: string, stageDir: string): Promise<boolean> {
  const proc = Bun.spawn(["unzip", "-oq", apkPath, "-d", stageDir], { stdout: "ignore", stderr: "ignore" })
  return (await proc.exited) === 0
}

function scanText(text: string): {
  permissions: PermissionRisk[]
  trackers: string[]
  suspicious: Array<[string, string]>
  urls: string[]
} {
  const foundPermissions: PermissionRisk[] = []
  const seen = new Set<string>()
  for (const [regex, risk, why] of DANGEROUS_PERMISSIONS) {
    const matches = text.match(new RegExp(`android\\.permission\\.${regex.source}`, "gi")) ?? []
    for (const match of matches) {
      const key = match.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      foundPermissions.push({ permission: match.replace("android.permission.", ""), risk, why })
    }
  }

  const trackers = TRACKER_SIGNATURES.filter((sig) => text.includes(sig))
  const suspicious: Array<[string, string]> = []
  for (const [regex, label] of SUSPICIOUS_STRINGS) {
    const source = regex instanceof RegExp ? regex.source : String(regex)
    if (new RegExp(source, "i").test(text)) suspicious.push([label, source.slice(0, 40)])
  }

  const urlSet = new Set<string>()
  for (const match of text.matchAll(/https?:\/\/[\w.-]+\.[a-z]{2,}(?:\/[^\s"'<>\\]{0,60})?/gi)) {
    const url = match[0]
    if (!url.includes("schemas.android.com") && !url.includes("w3.org") && !url.includes("apache.org")) {
      urlSet.add(url)
    }
  }

  return { permissions: foundPermissions, trackers, suspicious, urls: [...urlSet].slice(0, 15) }
}

async function scanApk(ctx: PluginContext): Promise<number | void> {
  const fileArg = ctx.args.find((a) => !a.startsWith("-"))
  if (!fileArg) {
    ctx.err("Usage: nexus security scan-apk <file.apk>")
    return 1
  }
  const apkPath = path.resolve(ctx.cwd, fileArg)
  if (!(await Bun.file(apkPath).exists())) {
    ctx.err(`File not found: ${apkPath}`)
    return 1
  }

  ctx.out(`${Icon.lock} NEXUS Mod Safety Scanner`)
  ctx.out(`  Target: ${path.basename(apkPath)} (${(((await Bun.file(apkPath).size) || 0) / 1024 / 1024).toFixed(1)} MB)`)

  const stageDir = path.join(ctx.env.tempDir, `nx-scan-${Date.now()}`)
  if (!(await extractApk(ctx, apkPath, stageDir))) {
    ctx.err("Extraction failed — valid zip/APK hai ya nahi check karo")
    return 1
  }

  let combinedText = ""
  const glob = new Bun.Glob("**/*.{dex,xml,arsc,json,txt}")
  for await (const rel of glob.scan({ cwd: stageDir })) {
    const content = await Bun.file(path.join(stageDir, rel)).text().catch(() => "")
    combinedText += content + "\n"
  }
  const soFiles = [...(await Array.fromAsync(new Bun.Glob("**/*.so").scan({ cwd: stageDir })))]
  const dexCount = [...(await Array.fromAsync(new Bun.Glob("**/*.dex").scan({ cwd: stageDir })))].length

  const result = scanText(combinedText)

  ctx.out(`${EOL}  ${Style.TEXT_NORMAL_BOLD}Permissions:${Style.TEXT_NORMAL}`)
  if (result.permissions.length === 0) {
    ctx.out(`    ${Icon.success} No high-risk permissions found in static scan`)
  }
  const iconFor = { critical: Icon.fail, high: Icon.warn, medium: Icon.info, low: "•" } as Record<string, string>
  for (const perm of result.permissions.sort((a, b) => ["critical", "high", "medium", "low"].indexOf(a.risk) - ["critical", "high", "medium", "low"].indexOf(b.risk))) {
    ctx.out(`    ${iconFor[perm.risk]} [${perm.risk}] ${perm.permission}`)
    ctx.out(`       ${Style.TEXT_DIM}${perm.why}${Style.TEXT_NORMAL}`)
  }

  if (result.trackers.length > 0) {
    ctx.out(`${EOL}  ${Style.TEXT_NORMAL_BOLD}Trackers detected:${Style.TEXT_NORMAL}`)
    for (const t of result.trackers) ctx.out(`    • ${t}`)
  }

  if (result.suspicious.length > 0) {
    ctx.out(`${EOL}  ${Style.TEXT_NORMAL_BOLD}Suspicious patterns:${Style.TEXT_NORMAL}`)
    for (const [label] of result.suspicious) ctx.out(`    ${Icon.warn} ${label}`)
  }

  if (result.urls.length > 0) {
    ctx.out(`${EOL}  ${Style.TEXT_NORMAL_BOLD}Network endpoints (${result.urls.length}):${Style.TEXT_NORMAL}`)
    for (const url of result.urls) ctx.out(`    • ${url}`)
  }

  ctx.out(`${EOL}  ${Style.TEXT_NORMAL_BOLD}Structure:${Style.TEXT_NORMAL} ${dexCount} dex, ${soFiles.length} native .so libraries`)
  if (soFiles.length > 0) ctx.out(`    ${Style.TEXT_DIM}${soFiles.slice(0, 6).join(", ")}${Style.TEXT_NORMAL}`)

  const riskScore =
    result.permissions.filter((p) => p.risk === "critical").length * 30 +
    result.permissions.filter((p) => p.risk === "high").length * 15 +
    result.permissions.filter((p) => p.risk === "medium").length * 5 +
    result.suspicious.length * 10 +
    Math.min(result.urls.length, 5)

  const verdict =
    riskScore >= 60 ? bad(`HIGH RISK — install mat karo`) : riskScore >= 25 ? `${Style.TEXT_WARNING_BOLD}CAUTION${Style.TEXT_NORMAL} — permissions review karo` : `${ok("LOW RISK")} — static scan clean`

  ctx.out(`${EOL}  ${Icon.robot} Verdict: ${verdict} (risk score ${riskScore})`)
  ctx.out(`  ${Style.TEXT_DIM}Static analysis only — runtime behaviour Frida se verify hota hai (re lab-setup)${Style.TEXT_NORMAL}`)

  await import("fs/promises").then((fs) => fs.rm(stageDir, { recursive: true, force: true }))
  return riskScore >= 60 ? 1 : 0
}

const LAB_TOOLS: Array<[string, string, string]> = [
  ["python3", "pkg install python", "scripting + frida host"],
  ["r2", "pkg install radare2", "reverse engineering framework"],
  ["openssl", "pkg install openssl", "crypto analysis"],
  ["apktool", "pkg install apktool", "APK decode/rebuild"],
  ["frida", "pip install frida-tools", "runtime instrumentation (device required)"],
]

const LAB_TARGETS = [
  ["crackmes.one", "https://crackmes.one", "Legal cracking puzzles — keygen, patching, crypto (difficulty sorted)"],
  ["OWASP UnCrackable APKs", "https://github.com/OWASP/owasp-mastg/tree/master/Crackmes", "Android RE training apps Level 1-4"],
  ["picoCTF", "https://picoctf.org", "Free CTF — reverse engineering tracks"],
  ["HackTheBox", "https://www.hackthebox.com", "Mobile challenge labs"],
  ["Cryptopals", "https://cryptopals.com", "Encryption banana/todna — 8 sets, industry standard"],
  ["MobSF live demo", "https://mobsf.live", "Browser-based mobile security scanning"],
]

async function labSetup(ctx: PluginContext): Promise<number | void> {
  ctx.out(`${Icon.rocket} NEXUS RE Lab setup (legal practice environment)`)

  let missing = 0
  for (const [bin, installCmd, purpose] of LAB_TOOLS) {
    const have = Bun.which(bin) !== null
    ctx.out(`  ${have ? Icon.success : Icon.fail} ${bin.padEnd(10)} ${Style.TEXT_DIM}${purpose}${Style.TEXT_NORMAL}`)
    if (!have) {
      missing++
      if (ctx.flags.fix === true && installCmd.startsWith("pkg ")) {
        const proc = Bun.spawn(["sh", "-c", installCmd], { cwd: ctx.cwd, stdout: "ignore", stderr: "ignore" })
        const okNow = (await proc.exited) === 0
        ctx.out(`      ${okNow ? Icon.success + " installed" : Icon.warn + " failed — manual: " + installCmd}`)
      } else if (!have) {
        ctx.out(`      ${Style.TEXT_DIM}install: ${installCmd}${Style.TEXT_NORMAL}`)
      }
    }
  }

  ctx.out(`${EOL}${Icon.brain} Practice targets (100% legal):`)
  for (const [name, url, desc] of LAB_TARGETS) {
    ctx.out(`  ${Style.TEXT_HIGHLIGHT_BOLD}${name.padEnd(24)}${Style.TEXT_NORMAL}${Style.TEXT_DIM}${desc}${Style.TEXT_NORMAL}`)
    ctx.out(`  ${Style.TEXT_DIM}${url}${Style.TEXT_NORMAL}${EOL}`)
  }

  if (missing > 0 && ctx.flags.fix !== true) ctx.out(`${Icon.info} Auto-install with: --fix`)
  return 0
}

async function labTargets(ctx: PluginContext): Promise<number | void> {
  for (const [name, url, desc] of LAB_TARGETS) {
    ctx.out(`${Style.TEXT_HIGHLIGHT_BOLD}${name}${Style.TEXT_NORMAL} — ${desc}`)
    ctx.out(`  ${Style.TEXT_DIM}${url}${Style.TEXT_NORMAL}`)
  }
  return 0
}

const plugin: NexusPlugin = {
  name: "security",
  version: "0.1.0",
  description: "Mod/APK safety scanner + legal reverse-engineering learning lab",
  tags: ["security", "apk", "scan", "learning"],
  commands: [
    { name: "scan-apk", describe: "scan any APK/mod for risky permissions, trackers, malware patterns", usage: "nexus security scan-apk <file.apk>", run: scanApk },
    { name: "lab-setup", describe: "set up a LEGAL reverse-engineering practice environment (--fix auto-installs)", usage: "nexus security lab-setup [--fix]", run: labSetup },
    { name: "lab-targets", describe: "curated legal RE/crypto practice platforms", usage: "nexus security lab-targets", run: labTargets },
  ],
}

export default plugin

export * as SecurityPlugin from "./security"
