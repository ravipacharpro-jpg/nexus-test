import { registerCustomTheme } from "@pierre/diffs"
import { NEXUSTheme } from "./marked-theme"

let registered = false

export function registerNEXUSTheme() {
  if (registered) return
  registered = true
  registerCustomTheme("NEXUS", () => Promise.resolve(NEXUSTheme))
}
