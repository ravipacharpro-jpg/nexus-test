import { Style, Icon } from "../core/style"
import type { NexusPlugin, PluginContext } from "../core/types"
import { Orchestrator } from "../core/orchestrator"
import { redactSensitive, containsSensitive } from "../core/redact"

export function guardVoiceCommand(
  command: string,
): { allowed: true; command: string } | { allowed: false; message: string } {
  if (containsSensitive(command)) {
    return {
      allowed: false,
      message: "Sensitive authentication content detected. Voice command was not displayed, stored, or routed.",
    }
  }
  return { allowed: true, command }
}

async function listen(ctx: PluginContext): Promise<number | void> {
  if (!process.env.TERMUX_VERSION && !process.env.PREFIX?.includes("com.termux")) {
    ctx.err("Voice mode needs Termux:API (termux-speech-to-text). Falling back to text input.")
  }

  const orchestrator = new Orchestrator()
  ctx.out(`${Icon.info} Voice Commander — speak or type a command. Type 'exit' to quit.`)

  for (;;) {
    process.stderr.write(`${Style.TEXT_HIGHLIGHT_BOLD}🎤 > ${Style.TEXT_NORMAL}`)
    const line = await readLine()

    if (!line || line.toLowerCase() === "exit" || line.toLowerCase() === "quit") {
      ctx.out("Voice mode ended")
      return 0
    }

    const guarded = guardVoiceCommand(line)
    if (!guarded.allowed) {
      ctx.err(`${Icon.lock} ${guarded.message}`)
      continue
    }
    const code = await orchestrator.process(guarded.command, ctx.cwd, ctx.llm)
    if (code !== 0) continue
  }
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let input = ""
    process.stdin.setEncoding("utf8")
    process.stdin.resume()
    const onData = (chunk: string) => {
      input += chunk
      if (input.includes("\n")) {
        process.stdin.pause()
        process.stdin.removeListener("data", onData)
        resolve(input.split("\n")[0]?.trim() ?? "")
      }
    }
    process.stdin.on("data", onData)
  })
}

async function oneShot(ctx: PluginContext): Promise<number | void> {
  let command = ctx.args.join(" ")

  if (typeof ctx.flags.voiceCommand === "string" && ctx.flags.voiceCommand) {
    command = ctx.flags.voiceCommand
  } else if (command.length === 0 && process.env.TERMUX_VERSION) {
    const proc = Bun.spawn(["termux-speech-to-text"], { stdout: "pipe", stderr: "inherit" })
    await proc.exited
    command = (await new Response(proc.stdout).text()).trim()
  }

  if (!command) {
    ctx.err('Usage: nexus voice --command "website test karo"')
    return 1
  }

  const guarded = guardVoiceCommand(command)
  if (!guarded.allowed) {
    ctx.err(`${Icon.lock} ${guarded.message}`)
    return 1
  }
  const safeCommand = guarded.command
  ctx.out(`${Icon.brain} Command: ${safeCommand}`)

  const confirm = await ctx.confirm({
    title: `Execute: ${safeCommand}?`,
  })
  if (!confirm) {
    ctx.out("Cancelled")
    return 0
  }

  const orchestrator = new Orchestrator()
  return orchestrator.process(safeCommand, ctx.cwd, ctx.llm)
}

const plugin: NexusPlugin = {
  name: "voice",
  version: "0.1.0",
  description: "Voice commander — speech-to-text commands via Termux:API with text fallback",
  tags: ["voice", "termux", "commands"],
  commands: [
    { name: "listen", describe: "continuous command loop", usage: "nexus voice listen", run: listen },
    {
      name: "say",
      describe: 'one-shot voice/text command, e.g. nexus voice say "todo app banao"',
      usage: 'nexus voice say "<command>"',
      run: oneShot,
    },
  ],
}

export default plugin

export * as VoicePlugin from "./voice"
