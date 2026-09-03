import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { cmd } from "./cmd"
import { Permission, type ExplainedDecision } from "@/permission"

export const inspectablePermissionCategories = ["bash", "edit", "read", "webfetch", "question"] as const
export type InspectablePermissionCategory = (typeof inspectablePermissionCategories)[number]

export function formatPermissionInspection(decision: ExplainedDecision): string {
  return [
    `Permission: ${decision.permission}`,
    `Action: ${decision.action}`,
    `Source: ${decision.source}`,
    "Scope: category-wide only; commands, paths, prompts, rule patterns, and credentials are never accepted or displayed.",
  ].join(EOL)
}

export const PermissionExplainCommand = effectCmd({
  command: "explain [category]",
  describe: "inspect a resolved project permission category without showing sensitive rule details",
  builder: (yargs) =>
    yargs.positional("category", {
      describe: "safe permission category to inspect; omit to inspect all supported categories",
      type: "string",
      choices: inspectablePermissionCategories,
    }),
  handler: Effect.fn("Cli.permission.explain")(function* (args: { category?: string }) {
    const { Config } = yield* Effect.promise(() => import("@/config/config"))
    const config = yield* Config.Service.use((cfg) => cfg.get())
    const project = config.permission ? Permission.fromConfig(config.permission) : []
    const categories: ReadonlyArray<InspectablePermissionCategory> = args.category
      ? [args.category as InspectablePermissionCategory]
      : inspectablePermissionCategories
    const output = categories.map((permission) =>
      formatPermissionInspection(
        Permission.explainDecision({
          permission,
          pattern: "*",
          project,
        }),
      ),
    )
    process.stdout.write(output.join(EOL + EOL) + EOL)
  }),
})

export const PermissionCommand = cmd({
  command: "permission",
  describe: "inspect safe, category-wide permission decisions",
  builder: (yargs) => yargs.command(PermissionExplainCommand).demandCommand(),
  async handler() {},
})
