/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeNexusContent from "./skill/customize-nexus.md" with { type: "text" }

export const CustomizeNexusContent = customizeNexusContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-nexus",
            description:
              "Use ONLY when the user is editing or creating nexus's own configuration: nexus.json, nexus.jsonc, files under .nexus/, or files under ~/.config/nexus/. Also use when creating or fixing nexus agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring nexus itself.",
            location: AbsolutePath.make("/builtin/customize-nexus.md"),
            content: CustomizeNexusContent,
          }),
        }),
      )
    })
  }),
})
