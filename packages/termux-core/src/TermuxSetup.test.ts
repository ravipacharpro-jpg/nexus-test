import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { setupTermuxKeyboard } from "./TermuxSetup"

test("rejects Termux keyboard setup outside Termux without touching files", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "nexus-termux-setup-"))
  try {
    const result = await setupTermuxKeyboard({ homeDir, isTermux: false })
    assert.equal(result.configured, false)
    assert.match(result.message, /only runs on Termux/i)
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})

test("backs up existing properties and writes a managed keyboard/paste configuration", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "nexus-termux-setup-"))
  const propertiesPath = join(homeDir, ".termux", "termux.properties")
  try {
    await writeFile(propertiesPath, "font-size = 16\n", { encoding: "utf8", flag: "w" }).catch(async () => {
      const directory = join(homeDir, ".termux")
      const { mkdir } = await import("node:fs/promises")
      await mkdir(directory, { recursive: true })
      await writeFile(propertiesPath, "font-size = 16\n", "utf8")
    })
    const result = await setupTermuxKeyboard({ homeDir, isTermux: true })
    assert.equal(result.configured, true)
    assert.equal(await readFile(`${propertiesPath}.backup`, "utf8"), "font-size = 16\n")
    const output = await readFile(propertiesPath, "utf8")
    assert.match(output, /font-size = 16/)
    assert.match(output, /'KEYBOARD','PASTE'/)
    assert.match(output, /soft-keyboard-toggle-behaviour = enable\/disable/)
    assert.match(result.message, /Restart Termux to apply/)

    await setupTermuxKeyboard({ homeDir, isTermux: true })
    const repeatedOutput = await readFile(propertiesPath, "utf8")
    assert.equal((repeatedOutput.match(/# >>> NEXUS Termux keyboard setup >>>/g) ?? []).length, 1)
    assert.match(repeatedOutput, /font-size = 16/)

    // Regression: re-runs must never overwrite the original backup with an
    // already-managed properties file.
    assert.equal(await readFile(`${propertiesPath}.backup`, "utf8"), "font-size = 16\n")
  } finally {
    await rm(homeDir, { recursive: true, force: true })
  }
})
