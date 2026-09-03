import { mkdir } from "fs/promises"
import path from "path"

export async function markPluginDependenciesReady(dir: string) {
  await mkdir(path.join(dir, "node_modules"), { recursive: true })
  await Bun.write(
    path.join(dir, "package-lock.json"),
    // Config bootstrap verifies this exact package before deciding whether to
    // launch a detached install. Keep the fixture aligned with the runtime
    // dependency so plugin-provider tests never make network work part of a
    // lifecycle assertion.
    JSON.stringify({ packages: { "": { dependencies: { "@opencode-ai/plugin": "0.0.0" } } } }),
  )
}
