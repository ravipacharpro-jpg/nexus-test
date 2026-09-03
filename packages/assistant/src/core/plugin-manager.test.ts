import { expect, test } from "bun:test"
import { PluginManager } from "./plugin-manager"

const config = {
  type: "termux" as const,
  maxPlugins: 3,
  idleTimeoutMs: 60_000,
  preferCloudAI: false,
  disabledPlugins: [],
  parallelJobs: 1,
  tempDir: "/tmp",
}

test("loads the shipped voice plugin through the packaged loader map", async () => {
  const manager = new PluginManager(config)
  const voice = await manager.get("voice")
  expect(voice.name).toBe("voice")
  expect(voice.commands.map((command) => command.name)).toContain("say")
  await manager.unload("voice")
})
