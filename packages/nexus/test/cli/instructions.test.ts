import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import {
  formatInstructionExplanation,
  formatInstructionStatus,
  inspectInstructionPaths,
} from "../../src/cli/cmd/instructions"

const tempDirectories: string[] = []

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-instructions-"))
  tempDirectories.push(root)
  fs.mkdirSync(path.join(root, "app", "nested"), { recursive: true })
  fs.writeFileSync(path.join(root, "NEXUS.md"), "api_key=must-not-be-read")
  fs.writeFileSync(path.join(root, "app", "AGENTS.md"), "password=must-not-be-read")
  fs.writeFileSync(path.join(root, "app", "nested", "CONTEXT.md"), "secret=must-not-be-read")
  return { root, nested: path.join(root, "app", "nested") }
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe("instruction transparency", () => {
  test("lists only known filename paths inside the supplied root in local precedence order", () => {
    const { root, nested } = fixture()
    const entries = inspectInstructionPaths(nested, root)

    expect(entries.map((entry) => entry.filename)).toEqual(["CONTEXT.md", "AGENTS.md", "NEXUS.md"])
    expect(entries.every((entry) => entry.path.startsWith(root))).toBe(true)
    expect(entries[0]).toMatchObject({ filename: "CONTEXT.md", precedence: 3 })
  })

  test("never echoes instruction contents and rejects an inspection path outside its root", () => {
    const { root, nested } = fixture()
    const output = formatInstructionStatus(nested, root)

    expect(output).toContain("names and paths only")
    expect(output).not.toContain("must-not-be-read")
    expect(() => inspectInstructionPaths(root, nested)).toThrow("within the supplied inspection root")
  })

  test("documents fixed precedence and redaction boundaries without reading a file", () => {
    const output = formatInstructionExplanation()
    expect(output).toContain("NEXUS.md -> AGENTS.md -> CLAUDE.md -> CONTEXT.md")
    expect(output).toContain("redacted")
    expect(output).toContain("never prints instruction contents")
  })
})
