import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { RunCommand } from "./cli/cmd/run"
import { GenerateCommand } from "./cli/cmd/generate"
import { ConsoleCommand } from "./cli/cmd/account"
import { ProvidersCommand } from "./cli/cmd/providers"
import { AgentCommand } from "./cli/cmd/agent"
import { BotCommand } from "./cli/cmd/bot"
import { DoCommand } from "./cli/cmd/do"
import { UpgradeCommand } from "./cli/cmd/upgrade"
import { UninstallCommand } from "./cli/cmd/uninstall"
import { ModelsCommand } from "./cli/cmd/models"
import { UI } from "./cli/ui"
import { InstallationVersion } from "@nexus-ai/core/installation/version"
import { FormatError } from "./cli/error"
import { ServeCommand } from "./cli/cmd/serve"
import { DebugCommand } from "./cli/cmd/debug"
import { StatsCommand } from "./cli/cmd/stats"
import { McpCommand } from "./cli/cmd/mcp"
import { GithubCommand } from "./cli/cmd/github"
import { ExportCommand } from "./cli/cmd/export"
import { ImportCommand } from "./cli/cmd/import"
import { AttachCommand } from "./cli/cmd/attach"
import { TuiThreadCommand } from "./cli/cmd/tui"
import { AcpCommand } from "./cli/cmd/acp"
import { EOL } from "os"
import { WebCommand } from "./cli/cmd/web"
import { PrCommand } from "./cli/cmd/pr"
import { SessionCommand } from "./cli/cmd/session"
import { DbCommand } from "./cli/cmd/db"
import { errorMessage } from "./util/error"
import { PluginCommand } from "./cli/cmd/plug"
import { SetupCommand } from "./cli/cmd/setup"
import { ConfigCommand } from "./cli/cmd/config"
import { DevCommand } from "./cli/cmd/dev"
import { LiaisonCommand } from "./cli/cmd/liaison"
import { ApiCommand } from "./cli/cmd/api"
import { AssistantCommand } from "./cli/cmd/assistant"
import { Heap } from "./cli/heap"
import { ModCommand } from "./cli/cmd/mod"
import { AssetCommand } from "./cli/cmd/asset"
import { LuaCommand } from "./cli/cmd/lua"
import { DoctorCommand } from "./cli/cmd/doctor"
import { ProfileCommand } from "./cli/cmd/profile"
import { OnboardCommand } from "./cli/cmd/onboard"
import { InstructionsCommand } from "./cli/cmd/instructions"
import { ArtifactCommand } from "./cli/cmd/artifact"
import { DeviceCommand } from "./cli/cmd/device"
import { PermissionCommand } from "./cli/cmd/permission"
import { WorkspaceCommand } from "./cli/cmd/workspace"
import { TranslatorCommand } from "./cli/cmd/translator"
import { IntentCommand } from "./cli/cmd/intent"
import { MemoryCommand } from "./cli/cmd/memory"

const rawArgs = hideBin(process.argv)
const args = rawArgs
const keepAliveForLiaisonTask = args[0] === "liaison" && args.length > 1

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("nexus ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
    process.stderr.write(text + EOL)
    return
  }
  process.stderr.write(out)
}

const cli = yargs(args)
  .parserConfiguration({ "populate--": true })
  .scriptName("nexus")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", InstallationVersion)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .option("pure", {
    describe: "run without external plugins",
    type: "boolean",
  })
  .middleware(async (opts) => {
    if (opts.printLogs) process.env.NEXUS_PRINT_LOGS = "1"
    if (opts.logLevel) process.env.NEXUS_LOG_LEVEL = opts.logLevel
    if (opts.pure) {
      process.env.NEXUS_PURE = "1"
    }

    Heap.start()

    process.env.AGENT = "1"
    process.env.NEXUS = "1"
    process.env.NEXUS_PID = String(process.pid)
  })
  .usage("")
  .completion("completion", "generate shell completion script")
  .command(AcpCommand)
  .command(McpCommand)
  .command(TuiThreadCommand)
  .command(AttachCommand)
  .command(RunCommand)
  .command(GenerateCommand)
  .command(DebugCommand)
  .command(ConsoleCommand)
  .command(ProvidersCommand)
  .command(AgentCommand)
  .command(BotCommand)
  .command(DoCommand)
  .command(UpgradeCommand)
  .command(UninstallCommand)
  .command(ServeCommand)
  .command(WebCommand)
  .command(ModelsCommand)
  .command(StatsCommand)
  .command(ExportCommand)
  .command(ImportCommand)
  .command(GithubCommand)
  .command(PrCommand)
  .command(SessionCommand)
  .command(PluginCommand)
  .command(DbCommand)
  .command(SetupCommand)
  .command(ConfigCommand)
  .command(DevCommand)
  .command(LiaisonCommand)
  .command(ApiCommand)
  .command(ModCommand)
  .command(AssetCommand)
  .command(LuaCommand)
  .command(AssistantCommand)
  .command(DoctorCommand)
  .command(ProfileCommand)
  .command(OnboardCommand)
  .command(ArtifactCommand)
  .command(DeviceCommand)
  .command(InstructionsCommand)
  .command(PermissionCommand)
  .command(WorkspaceCommand)
  .command(TranslatorCommand)
  .command(IntentCommand)
  .command(MemoryCommand)
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp(show)
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

let nexusCleanupDone = false
function nexusCleanup(): void {
  if (nexusCleanupDone) return
  nexusCleanupDone = true
  if (process.platform === "linux" && require("fs").existsSync("/data/data/com.termux/files/usr/bin/termux-wake-unlock")) {
    try {
      Bun.spawnSync(["termux-wake-unlock"], { stdout: "ignore", stderr: "ignore" })
    } catch {}
  }
}

process.on("SIGINT", () => {
  nexusCleanup()
  process.stderr.write(EOL + "\x1b[96m[nexus]\x1b[0m closed cleanly\n")
  process.exit(130)
})
process.on("SIGTERM", () => {
  nexusCleanup()
  process.exit(143)
})

try {
  if (args.includes("-h") || args.includes("--help")) {
    await cli.parse(args, (err: Error | undefined, _argv: unknown, out: string) => {
      if (err) throw err
      if (!out) return
      show(out)
    })
  } else {
    await cli.parse()
  }
} catch (e) {
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error" + EOL)
    process.stderr.write(errorMessage(e) + EOL)
  }
  process.exitCode = 1
} finally {
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  nexusCleanup()
  if (!keepAliveForLiaisonTask) process.exit()
}
