import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import plugin, { review } from "./gitpro"

const roots: string[] = []

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" })
}

function makeRepository() {
  const root = mkdtempSync(join(tmpdir(), "nexus-gitpro-"))
  roots.push(root)
  git(root, "init")
  git(root, "config", "user.name", "NEXUS Test")
  git(root, "config", "user.email", "nexus@example.test")
  writeFileSync(join(root, "README.md"), "initial\n")
  git(root, "add", "README.md")
  git(root, "commit", "-m", "chore: initial")
  return root
}

function context(cwd: string, flags: Record<string, unknown> = {}) {
  const out: string[] = []
  const err: string[] = []
  return {
    cwd,
    args: [],
    flags,
    out: (message: string) => out.push(message),
    err: (message: string) => err.push(message),
    confirm: async () => flags.confirm === true,
    messages: { out, err },
  } as any
}

function command(name: string) {
  const found = plugin.commands.find((item) => item.name === name)
  if (!found) throw new Error(`Missing Git Pro command: ${name}`)
  return found
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe("GitPro diff-first workflow", () => {
  test("shows a bounded change plan without staging or committing", async () => {
    const root = makeRepository()
    writeFileSync(join(root, "README.md"), "changed\n")
    const ctx = context(root, { patch: true })
    expect(await command("plan").run(ctx)).toBe(0)
    expect(ctx.messages.out.join("\n")).toContain("Review plan")
    expect(git(root, "diff", "--cached")).toBe("")
    expect(git(root, "log", "-1", "--format=%s").trim()).toBe("chore: initial")
  })

  test("never stages or commits unstaged changes without an explicit --stage request", async () => {
    const root = makeRepository()
    writeFileSync(join(root, "README.md"), "changed\n")
    const ctx = context(root, { message: "docs: revise readme", confirm: true })
    expect(await command("commit").run(ctx)).toBe(1)
    expect(git(root, "diff", "--cached")).toBe("")
    expect(git(root, "log", "-1", "--format=%s").trim()).toBe("chore: initial")
  })

  test("stages and commits only after explicit stage and confirmation flags", async () => {
    const root = makeRepository()
    writeFileSync(join(root, "README.md"), "approved change\n")
    const ctx = context(root, { message: "docs: approve readme", stage: true, confirm: true })
    expect(await command("commit").run(ctx)).toBeUndefined()
    expect(git(root, "log", "-1", "--format=%s").trim()).toBe("docs: approve readme")
  })

  test("blocks secret-bearing changes even when confirmation, staging, and legacy no-verify are requested", async () => {
    const root = makeRepository()
    writeFileSync(join(root, "README.md"), "-----BEGIN PRIVATE KEY-----\n")
    expect(review("+-----BEGIN PRIVATE KEY-----")).toHaveLength(1)
    const ctx = context(root, { message: "test: add secret", stage: true, confirm: true, noVerify: true })
    expect(await command("commit").run(ctx)).toBe(1)
    expect(ctx.messages.err.join("\n")).toContain("Commit blocked")
    expect(git(root, "log", "-1", "--format=%s").trim()).toBe("chore: initial")
  })
})
