import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { UserLiaison } from "@nexus/termux-core"
import { isBareUserTask, routeAssistantPluginArgs, runBareUserTask } from "./quick-liaison"

const GIB = 1024 * 1024 * 1024

function memory(totalGiB: number, availableGiB: number) {
  return `MemTotal: ${totalGiB * 1024 * 1024} kB\nMemAvailable: ${availableGiB * 1024 * 1024} kB\n`
}

test("routes plain task input through the immediate liaison path", () => {
  assert.equal(isBareUserTask(["big task"]), true)
  assert.equal(isBareUserTask(["setup", "termux"]), false)
  assert.equal(isBareUserTask(["--help"]), false)
})

test("routes documented Assistant plugin aliases before bare-task handling", () => {
  assert.deepEqual(routeAssistantPluginArgs(["voice", "say"]), ["assistant", "voice", "say"])
  assert.deepEqual(routeAssistantPluginArgs(["webtest", "run", "https://example.test"]), ["assistant", "webtest", "run", "https://example.test"])
  assert.deepEqual(routeAssistantPluginArgs(["assistant", "voice", "say"]), ["assistant", "voice", "say"])
  assert.equal(isBareUserTask(routeAssistantPluginArgs(["voice", "say"])), false)
  assert.equal(isBareUserTask(routeAssistantPluginArgs(["custom task"])), true)
})

test("keeps the local intent inspection command out of bare-task interception", () => {
  assert.equal(isBareUserTask(["intent", "workspace", "list"]), false)
  assert.deepEqual(routeAssistantPluginArgs(["intent", "workspace"]), ["intent", "workspace"])
})

test("bare task acknowledgements expose simulated desktop High and Termux Low capacity plans", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexus-quick-liaison-"))
  const previousQueuePath = process.env.NEXUS_QUEUE_PATH
  try {
    for (const scenario of [
      { expected: "Device: PC (16GB) → HIGH mode", probe: { isTermux: false, totalMemoryBytes: 16 * GIB, processMemoryBytes: 0, meminfo: memory(16, 14) } },
      { expected: "Device: Termux (2GB) → LOW mode", probe: { isTermux: true, totalMemoryBytes: 2 * GIB, processMemoryBytes: 0, meminfo: memory(2, 1) } },
    ]) {
      process.env.NEXUS_QUEUE_PATH = join(root, `${scenario.probe.isTermux ? "termux" : "desktop"}.json`)
      const output: string[] = []
      const liaison = new UserLiaison({ background: true, notify: false, capacityProbe: scenario.probe })
      await runBareUserTask(["big task"], { liaison, write: (text) => output.push(text) })
      assert.match(output.join(""), new RegExp(scenario.expected.replace(/[()]/g, "\\$&")))
      assert.doesNotMatch(output.join(""), /queued/i)
    }
  } finally {
    if (previousQueuePath === undefined) delete process.env.NEXUS_QUEUE_PATH
    else process.env.NEXUS_QUEUE_PATH = previousQueuePath
    await rm(root, { recursive: true, force: true })
  }
})

test("bare task failures exit nonzero with a clean error instead of leaking bundled internals", async () => {
  const failingLiaison = {
    handleUserMessage: async () => {
      throw new Error("EROFS: read-only file system, mkdir '/tmp'")
    },
  } as unknown as UserLiaison
  const previousExitCode = process.exitCode
  const errors: string[] = []
  try {
    process.exitCode = undefined
    await runBareUserTask(["big task"], { liaison: failingLiaison, writeError: (text) => errors.push(text) })
    assert.equal(process.exitCode, 1)
    assert.match(errors.join(""), /Task failed: EROFS/)
    assert.doesNotMatch(errors.join(""), /async function/)
  } finally {
    process.exitCode = previousExitCode
  }
})
