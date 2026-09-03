import type { Argv } from "yargs"
import { cmd } from "./cmd"

export const LiaisonCommand = cmd({
  command: "liaison [message..]",
  describe: "route a message through the NEXUS User Liaison",
  builder: (yargs: Argv) => yargs.positional("message", { type: "string", array: true, default: [], describe: "message to classify or execute" }).option("dir", { type: "string", default: process.cwd(), describe: "repository directory for dev tasks" }),
  async handler(args: { message: string[]; dir: string }) {
    const { UserLiaison } = await import("@nexus/termux-core")
    const message = args.message.join(" ").trim()
    if (!message) {
      process.stdout.write("Send a message or task for NEXUS to handle.\n")
      return
    }
    const liaison = new UserLiaison({ onUpdate: (status) => {
      if (process.stdout.isTTY && status.taskId !== "solo") process.stdout.write(`Progress: ${status.status} (${status.progress}%)\n`)
    } })
    process.stdout.write((await liaison.handleUserMessage(message, "local", args.dir)) + "\n")
  },
})
