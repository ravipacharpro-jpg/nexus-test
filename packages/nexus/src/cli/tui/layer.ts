import { run as runTui, type TuiInput } from "@nexus-ai/tui"
import { Global } from "@nexus-ai/core/global"
import { AppNodeBuilder } from "@nexus-ai/core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}
