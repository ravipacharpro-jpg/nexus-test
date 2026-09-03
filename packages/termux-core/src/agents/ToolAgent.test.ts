// @ts-nocheck -- this file is executed by Bun's test runner; production code remains type-checked separately.
import { expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ToolAgent } from "./ToolAgent"

function runTool(path: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(path, [], { stdio: ["pipe", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => (stdout += String(chunk)))
    child.stderr.on("data", (chunk) => (stderr += String(chunk)))
    child.on("error", reject)
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr || `tool exited ${code}`))))
    child.stdin.end(input)
  })
}

test("generated tools preserve JSON stdin/stdout and register local metadata", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "nexus-tool-agent-"))
  try {
    const agent = new ToolAgent({ homeDir, prefix: "/" })
    const generated = await agent.execute("verify JSON tool", { hiredWorkers: [] })
    const output = JSON.parse(await runTool(join(generated.outputDir, "run.sh"), '{"mission":"verify"}\n'))
    expect(output).toEqual({
      ok: true,
      tool: "verify-json-tool",
      task: "verify JSON tool",
      input: { mission: "verify" },
    })
    expect(generated.files).toEqual(["run.sh", "run.js"])

    const registry = JSON.parse(await readFile(join(homeDir, ".nexus", "tools", "registry.json"), "utf8"))
    expect(registry).toEqual([
      expect.objectContaining({ name: "verify-json-tool", path: generated.outputDir, runtime: "node" }),
    ])
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})
