import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  clearWorkspaceSelection,
  formatWorkspaceDetail,
  formatWorkspaceList,
  formatWorkspaceSelection,
  readWorkspaceSelection,
  validatedWorkspaceDisplayName,
  workspaceNavigationCommand,
  writeWorkspaceSelection,
  workspaceSummary,
} from "../../src/cli/cmd/workspace"

describe("workspace CLI safety", () => {
  const project = {
    id: "proj_safe",
    worktree: "/private/workspaces/demo project's app",
    name: "Demo app",
    vcs: "git",
    sandboxes: ["/private/workspaces/demo project's app/.sandbox"],
    time: { created: 100, updated: 200 },
  } as any

  test("lists only safe project metadata and omits local directory paths", () => {
    const summary = workspaceSummary(project)
    const table = formatWorkspaceList([project], "table")
    const json = formatWorkspaceList([project], "json")

    expect(summary).toEqual({ id: "proj_safe", name: "Demo app", vcs: "git", updated: 200, sandboxCount: 1 })
    expect(table).toContain("Demo app")
    expect(json).toContain('"sandboxCount": 1')
    expect(table).not.toContain("/private/workspaces")
    expect(json).not.toContain("/private/workspaces")
  })

  test("normalizes control characters in metadata before terminal output", () => {
    const output = formatWorkspaceList([{ ...project, name: "Demo\n\u001b[31mapp" }], "table")

    expect(output).toContain("Demo [31mapp")
    expect(output).not.toContain("\u001b")
    expect(output).not.toContain("\n\u001b[31m")
  })

  test("shows selected project detail explicitly without a mutation claim", () => {
    const table = formatWorkspaceDetail(project, "table")
    const json = formatWorkspaceDetail(project, "json")

    expect(table).toContain("Project ID: proj_safe")
    expect(table).toContain("Worktree: /private/workspaces/demo project's app")
    expect(table).toContain("Read-only detail: no project metadata")
    expect(json).toContain('"worktree": "/private/workspaces/demo project\'s app"')
  })

  test("accepts only bounded printable local display names for explicit confirmed updates", () => {
    expect(validatedWorkspaceDisplayName("  Demo   Workspace  ")).toBe("Demo Workspace")
    expect(validatedWorkspaceDisplayName("\u001bhidden")).toBeUndefined()
    expect(validatedWorkspaceDisplayName(" ")).toBeUndefined()
    expect(validatedWorkspaceDisplayName("x".repeat(81))).toBeUndefined()
  })

  test("prints a shell-escaped copy-only navigation command for an explicitly selected project", () => {
    const directory = "/private/workspaces/demo project's app"

    expect(workspaceNavigationCommand(directory, "linux")).toBe(`cd -- '/private/workspaces/demo project'"'"'s app'`)
    expect(workspaceNavigationCommand(directory, "win32")).toBe(
      "Set-Location -LiteralPath '/private/workspaces/demo project''s app'",
    )
  })

  test("persists and clears an explicit local selection bookmark without storing project paths", async () => {
    const configDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-workspace-selection-"))
    const selection = await writeWorkspaceSelection({ configDirectory, projectID: "proj_safe", selectedAt: 123 })
    const stored = await readWorkspaceSelection(configDirectory)
    const file = await fs.readFile(path.join(configDirectory, "workspace-selection.json"), "utf8")

    expect(stored).toEqual(selection)
    expect(file).not.toContain("/private/workspaces")
    expect(formatWorkspaceSelection(stored, project)).toContain("Selected workspace bookmark: proj_safe")
    expect(formatWorkspaceSelection(stored, project)).toContain("does not change the current shell directory")
    expect(await clearWorkspaceSelection(configDirectory)).toBe(true)
    expect(await readWorkspaceSelection(configDirectory)).toBeUndefined()
    await fs.rm(configDirectory, { recursive: true, force: true })
  })
})
