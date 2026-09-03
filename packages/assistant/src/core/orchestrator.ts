import path from "path"
import { EOL } from "os"
import { detectEnvironment } from "./adaptive"
import { PluginManager } from "./plugin-manager"
import { makeContext, audit } from "./security"
import { Style, Icon } from "./style"
import type { PluginContext, UserIntent } from "./types"

interface Route {
  regex: RegExp
  plugin: string
  command: string
}

const ROUTES: Route[] = [
  { regex: /(?:code|project|app|website|portfolio|todo).*(?:banao|bana|generate|create|scaffold)/i, plugin: "codegen", command: "generate" },
  { regex: /(?:dockerize|docker\s*file)/i, plugin: "codegen", command: "dockerize" },
  { regex: /(?:serve|server\s*(?:chalao|start)|localhost.*(?:start|run))/i, plugin: "codegen", command: "serve" },
  { regex: /(?:env|environment|variable|\.env).*(?:check|scan|detect|missing|fix)?/i, plugin: "devtools", command: "env:scan" },
  { regex: /(?:deps|dependencies|packages?).*(?:check|audit|outdated|unused|fix)/i, plugin: "devtools", command: "deps:check" },
  { regex: /(?:error|bug).*(?:fix|doctor|explain)|(?:log)\s*doctor/i, plugin: "devtools", command: "doctor:explain" },
  { regex: /(?:api).*(?:docs?|document)/i, plugin: "devtools", command: "api:scan" },
  { regex: /(?:backup|snapshot|restore|undo|pehle\s*jaisa)/i, plugin: "recovery", command: "save" },
  { regex: /(?:sab\s*projects?|workspace|monorepo).*(?:run|list|init|sync)/i, plugin: "workspace", command: "run" },
  { regex: /(?:translate|convert).*(?:php|python|nodejs?|typescript|javascript|tailwind|vue)/i, plugin: "translator", command: "translate" },
  { regex: /(?:commit|git\s*review|pr\s*banao)/i, plugin: "gitpro", command: "commit" },
  { regex: /(?:cpanel|hosting|domain|subdomain|ssl|softaculous)/i, plugin: "cpanel", command: "run" },
  { regex: /(?:deploy|upload|push|live|daalo|daalo).*(?:server|hosting|live|ftp|ssh)?/i, plugin: "deploy", command: "ssh" },
  { regex: /(?:website|site|page|url).*(?:test|check|bugs?)/i, plugin: "webtest", command: "run" },
  { regex: /(?:design|ui|ux|layout|responsive).*(?:check|review|analyze|qa)/i, plugin: "webtest", command: "visual" },
  { regex: /(?:browser|copilot).*(?:kholo|open|click|fill|bharo)/i, plugin: "copilot", command: "do" },
  { regex: /(?:github|google|openai|stripe|cloudflare).*(?:connect|link|oauth)/i, plugin: "integrations", command: "connect" },
  { regex: /(?:notification|notify|toast|battery|clipboard|apk|location)/i, plugin: "termux", command: "run" },
  { regex: /(?:voice|bol|sun|speak|listen)/i, plugin: "voice", command: "listen" },
  { regex: /(?:background|peeche|bg).*(?:chalao|run|install)|long task/i, plugin: "bg", command: "run" },
  { regex: /(?:apk|mod).*(?:scan|check|safe|malware)|(?:safety).*(?:scan)/i, plugin: "security", command: "scan-apk" },
  { regex: /(?:agent|daemon|server|ai).*(?:24x7|chalu|start|chalne|band|stop|status)/i, plugin: "daemon", command: "start" },
]

const MUTATING_PLUGINS = new Set(["codegen", "deploy", "translator", "gitpro"])

export class Orchestrator {
  private manager = new PluginManager(detectEnvironment())

  async process(input: string, cwd: string, llm?: PluginContext["llm"], flags: Record<string, unknown> = {}): Promise<number> {
    const merged = { ...parseFlags(input), ...flags }
    const cleanInput = input.replace(/\s--?[a-zA-Z][\w-]*(?:[= ][^\s]+)?/g, " ").trim()
    let intent = this.classify(cleanInput)
    if (!intent) {
      const aiIntent = await this.classifyWithLLM(input, llm)
      if (!aiIntent) {
        this.printHelp(input)
        return 1
      }
      intent = aiIntent
    }

    if (intent.confidence < 0.8) {
      process.stderr.write(`${Style.TEXT_DIM}Did you mean: ${intent.plugin} ${intent.command}?${Style.TEXT_NORMAL}${EOL}`)
    }

    process.stderr.write(`${Icon.robot} ${Style.TEXT_HIGHLIGHT_BOLD}NEXUS${Style.TEXT_NORMAL} ${Style.TEXT_DIM}→ ${intent.plugin}:${intent.command}${Style.TEXT_NORMAL}${EOL}`)

    let plugin
    try {
      plugin = await this.manager.get(intent.plugin)
    } catch (e) {
      process.stderr.write(`${Icon.fail} ${e instanceof Error ? e.message : String(e)}${EOL}`)
      return 1
    }

    const handler = plugin.commands.find((c) => c.name === intent.command)
    if (!handler) {
      process.stderr.write(`${Icon.fail} Command '${intent.command}' not found in plugin '${intent.plugin}'${EOL}`)
      return 1
    }

    audit("orchestrator.route", { plugin: intent.plugin, command: intent.command })

    if (MUTATING_PLUGINS.has(intent.plugin)) {
      try {
        const recoveryMod = await import("../plugins/recovery")
        const recoveryPlugin = (recoveryMod.default ?? (recoveryMod as unknown as { plugin: never }).plugin) as {
          commands: Array<{ name: string; run: (ctx: PluginContext) => Promise<number | void> }>
        }
        const saveCmd = recoveryPlugin.commands.find((c) => c.name === "save")
        if (saveCmd) {
          const snapName = `pre-ai-${Date.now().toString(36)}`
          const snapCtx = makeContext({
            cwd,
            env: detectEnvironment(),
            args: [cwd],
            flags: {},
            out: () => {},
            err: () => {},
            llm,
          })
          process.env.NEXUS_ASSUME_YES = "1"
          await saveCmd.run(snapCtx)
          delete process.env.NEXUS_ASSUME_YES
          await Bun.write(path.join(process.env.HOME ?? cwd, ".nexus", "last-ai-snapshot"), `${snapName}\n${cwd}`)
          process.stderr.write(`${Icon.lock} Auto-snapshot saved — undo: nexus undo-ai${EOL}`)
        }
      } catch {}
    }

    const ctx = makeContext({
      cwd,
      env: detectEnvironment(),
      args: intent.args,
      flags: merged,
      out: (message) => process.stderr.write(message + EOL),
      err: (message) => process.stderr.write(`${Style.TEXT_DANGER}${message}${Style.TEXT_NORMAL}${EOL}`),
      llm,
    })

    const result = await handler.run(ctx)
    return typeof result === "number" ? result : 0
  }

  manager_() {
    return this.manager
  }
  private classify(input: string): UserIntent | undefined {
    for (const route of ROUTES) {
      if (route.regex.test(input)) {
        const args = extractArgs(input)
        return { plugin: route.plugin, command: route.command, args, confidence: 0.95, query: input }
      }
    }
    const words = input.trim().split(/\s+/)
    const [maybePlugin, maybeCommand] = words
    if (maybePlugin && this.manager.available().includes(maybePlugin.toLowerCase())) {
      return {
        plugin: maybePlugin.toLowerCase(),
        command: maybeCommand ?? "help",
        args: words.slice(2),
        confidence: 0.9,
        query: input,
      }
    }
    return undefined
  }

  private async classifyWithLLM(input: string, llm?: PluginContext["llm"]): Promise<UserIntent | undefined> {
    if (!llm) return undefined
    try {
      const answer = await llm.generate(
        `Classify this user request into EXACT JSON: {"plugin":"one of ${this.manager.available().join("|")}","command":"best matching subcommand or run","args":[...]}\nRequest: ${input}\nReply ONLY with JSON.`,
      )
      const parsed = JSON.parse(answer.slice(answer.indexOf("{"), answer.lastIndexOf("}") + 1)) as Partial<UserIntent>
      if (!parsed.plugin || !this.manager.available().includes(parsed.plugin)) return undefined
      return { ...parsed, args: parsed.args ?? [], confidence: 0.75, query: input } as UserIntent
    } catch {
      return undefined
    }
  }

  private printHelp(input: string) {
    process.stderr.write(`${Icon.warn} Kya karna hai, samajh nahi aaya: "${input}"${EOL}${EOL}`)
    process.stderr.write(`${Style.TEXT_NORMAL_BOLD}Available plugins:${Style.TEXT_NORMAL}${EOL}`)
    for (const name of this.manager.available()) {
      process.stderr.write(`  ${Style.TEXT_INFO}${name.padEnd(14)}${Style.TEXT_NORMAL}${Style.TEXT_DIM}nexus ${name} --help${Style.TEXT_NORMAL}${EOL}`)
    }
  }
}

export function parseFlags(input: string): Record<string, unknown> {
  const flags: Record<string, unknown> = {}
  const regex = /--([a-zA-Z][\w-]*)(?:[= ](?:"([^"]*)"|'([^']*)'|([^-\s][^\s]*)))?/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(input))) {
    const key = match[1].replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    const raw = match[2] ?? match[3] ?? match[4]
    if (raw !== undefined && raw !== "") {
      flags[key] = /^\d+$/.test(raw) ? parseInt(raw) : raw
    } else {
      flags[key] = true
    }
  }
  return flags
}

function extractArgs(input: string): string[] {
  const quoted = input.match(/"([^"]+)"|'([^']+)'/)
  if (quoted) return [(quoted[1] ?? quoted[2]) as string]
  return input
    .replace(/[.,!?]+$/g, "")
    .split(/\s+/)
    .filter((word) => !/^(karo|banao|bana|de|do|mujhe|ek|ka|ki|ke|mein|pe|se|hai|please)$/i.test(word))
    .slice(0, 3)
}

export * as OrchestratorModule from "./orchestrator"
