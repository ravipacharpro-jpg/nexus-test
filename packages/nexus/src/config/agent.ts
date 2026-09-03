export * as ConfigAgent from "./agent"

import path from "path"
import { Exit, Schema } from "effect"
import { Glob } from "@nexus-ai/core/util/glob"
import { ConfigAgentV1 } from "@nexus-ai/core/v1/config/agent"
import { configEntryNameFromPath } from "./entry-name"
import * as ConfigMarkdown from "./markdown"
import { ConfigParse } from "./parse"

export async function load(dir: string) {
  const items = await Glob.scan("{agent,agents}/**/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })
  // Parse every agent .md in parallel. With 276+ agents the old
  // for/await loop was the single biggest contributor to NEXUS
  // startup latency. Promise.all caps the wall time at the slowest
  // single parse, not the sum of all of them. Each parse is pure
  // (read + decode) so the order of entries in `result` does not
  // matter for downstream consumers.
  const parsed = await Promise.all(
    items.map(async (item) => {
      const md = await ConfigMarkdown.parse(item).catch(() => undefined)
      if (!md) return undefined
      const name = configEntryNameFromPath(path.relative(dir, item), ["agent/", "agents/"])
      const config = {
        name,
        ...md.data,
        prompt: md.content.trim(),
      }
      return [name, ConfigParse.schema(ConfigAgentV1.Info, config, item)] as const
    }),
  )
  const result: Record<string, ConfigAgentV1.Info> = {}
  for (const entry of parsed) {
    if (!entry) continue
    const [name, info] = entry
    result[name] = info
  }
  return result
}

export async function loadMode(dir: string) {
  const result: Record<string, ConfigAgentV1.Info> = {}
  for (const item of await Glob.scan("{mode,modes}/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(() => undefined)
    if (!md) continue

    const config = {
      name: configEntryNameFromPath(path.relative(dir, item), ["mode/", "modes/"]),
      ...md.data,
      prompt: md.content.trim(),
    }
    const parsed = Schema.decodeUnknownExit(ConfigAgentV1.Info)(config, { errors: "all", propertyOrder: "original" })
    if (Exit.isSuccess(parsed)) {
      result[config.name] = {
        ...parsed.value,
        mode: "primary" as const,
      }
    }
  }
  return result
}
