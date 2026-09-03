import { afterEach, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ToolGenerator } from "./ToolGenerator"

const savedHome = process.env.HOME

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME
  else process.env.HOME = savedHome
})

test("generated Node, Python, and Bash tools execute the JSON input and output contract", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-tool-test-"))
  process.env.HOME = home
  for (const language of ["node", "python", "bash"] as const) {
    const name = `sample ${language}`
    ToolGenerator.generateTool(name, "Accept JSON and echo its input", language)
    const safeName = `sample-${language}`
    const runner = path.join(home, ".nexus", "tools", safeName, "run.sh")
    const result = spawnSync(runner, [], { encoding: "utf8", input: JSON.stringify({ mission: "verify" }) })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      tool: safeName,
      description: "Accept JSON and echo its input",
      input: { mission: "verify" },
    })
    expect(fs.statSync(runner).mode & 0o111).not.toBe(0)
  }

  const registry = JSON.parse(fs.readFileSync(path.join(home, ".nexus", "tools", "registry.json"), "utf8"))
  expect(registry.map((entry: { language: string }) => entry.language)).toEqual(["node", "python", "bash"])
})
