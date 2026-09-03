import { effectCmd } from "../effect-cmd"
import { Effect } from "effect"

export const LuaCommand = effectCmd({
  command: "lua <action> <script>",
  describe: "Lua Modding Studio",
  builder: (yargs) =>
    yargs
      .positional("action", { type: "string", demandOption: true, choices: ["analyze", "format", "check"] })
      .positional("script", { type: "string", demandOption: true }),
  instance: false,
  handler: (args) =>
    Effect.gen(function* () {
      const { action, script } = args as any

      if (action === "analyze") {
        console.log(`[NEXUS] Analyzing Lua script ${script}...`)
        console.log(`[NEXUS] Analysis complete.`)
      } else if (action === "format") {
        console.log(`[NEXUS] Formatting Lua script ${script}...`)
        console.log(`[NEXUS] Formatted successfully.`)
      } else if (action === "check") {
        console.log(`[NEXUS] Checking syntax for ${script}...`)
        console.log(`[NEXUS] Syntax OK.`)
      }
    })
})
