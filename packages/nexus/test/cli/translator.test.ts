import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import {
  collectTranslationFiles,
  createTranslationPlan,
  formatTranslationPlan,
  isPathWithin,
  writeTranslationReport,
} from "../../src/cli/cmd/translator"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  )
})

describe("translator planning", () => {
  test("keeps local collection in the requested project scope and skips ignored directories and symlinks", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-translator-"))
    temporaryDirectories.push(root)
    await fs.mkdir(path.join(root, "src"), { recursive: true })
    await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true })
    await fs.writeFile(path.join(root, "src", "app.ts"), "export const app = true")
    await fs.writeFile(path.join(root, "src", "view.tsx"), "export const view = true")
    await fs.writeFile(path.join(root, "node_modules", "pkg", "ignored.ts"), "export const ignored = true")
    await fs.symlink(path.join(root, "src", "app.ts"), path.join(root, "linked.ts"))

    const collected = await collectTranslationFiles({ root, scope: ".", language: "typescript", maxFiles: 10 })

    expect(collected).toEqual({ files: ["src/app.ts", "src/view.tsx"], truncated: false })
    expect(isPathWithin(root, path.resolve(root, "src"))).toBe(true)
    expect(isPathWithin(root, path.resolve(root, ".."))).toBe(false)
  })

  test("creates a bounded manual-review report without raw content or terminal control characters", () => {
    const plan = createTranslationPlan({
      source: "typescript",
      target: "python",
      scope: "src\n\u001b[31m",
      files: ["src/app.ts", "src/secret-token.ts"],
      truncated: true,
    })
    const table = formatTranslationPlan(plan, "table")
    const json = formatTranslationPlan(plan, "json")

    expect(table).toContain("manual review required; not executed")
    expect(table).toContain("Eligible files: 2")
    expect(table).toContain("does not read file contents, call a model, or write translated output")
    expect(table).not.toContain("\u001b")
    expect(json).toContain('"truncated": true')
    expect(json).not.toContain("\u001b")
  })

  test("rejects translation scopes outside the current project", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-translator-"))
    temporaryDirectories.push(root)

    await expect(collectTranslationFiles({ root, scope: "..", language: "python", maxFiles: 10 })).rejects.toThrow(
      "Translation scope must stay inside the current project",
    )
  })

  test("writes a confirmed manual-review report only as a new project-contained JSON file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-translator-"))
    temporaryDirectories.push(root)
    const plan = createTranslationPlan({
      source: "typescript",
      target: "python",
      scope: "src",
      files: ["src/app.ts"],
      truncated: false,
    })

    const report = await writeTranslationReport({ root, output: "reports/translation-plan.json", plan })

    expect(report).toBe("reports/translation-plan.json")
    expect(JSON.parse(await fs.readFile(path.join(root, report), "utf8"))).toEqual(plan)
    await expect(writeTranslationReport({ root, output: report, plan })).rejects.toThrow()
    await expect(writeTranslationReport({ root, output: "../outside.json", plan })).rejects.toThrow(
      "Translation report path must stay inside the current project",
    )
  })
})
