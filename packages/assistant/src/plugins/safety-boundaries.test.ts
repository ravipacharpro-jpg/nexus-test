import { describe, expect, test } from "bun:test"
import { requireAuthorizedTarget } from "../core/security"
import type { PluginContext } from "../core/types"
import { COPILOT_LAUNCH_ARGS } from "./copilot"
import daemon from "./daemon"
import deploy from "./deploy"
import cpanel from "./cpanel"
import webtest from "./webtest"

function context(flags: Record<string, unknown> = {}, confirm = async () => true): PluginContext & { errors: string[]; output: string[] } {
  const errors: string[] = []
  const output: string[] = []
  return {
    cwd: process.cwd(),
    env: { type: "pc", maxPlugins: 1, idleTimeoutMs: 1, preferCloudAI: false, disabledPlugins: [], parallelJobs: 1, tempDir: "/tmp" },
    args: [],
    flags,
    confirm,
    out: (message) => output.push(message),
    err: (message) => errors.push(message),
    errors,
    output,
  }
}

describe("Assistant safety boundaries", () => {
  test("blocks browser and HTTP targets until explicit ownership authorization is passed", async () => {
    const ctx = context()
    await expect(requireAuthorizedTarget(ctx, "https://example.test", "WebTest")).resolves.toBe(false)
    expect(ctx.errors.join("\n")).toContain("--authorize-target")
  })

  test("does not proceed when the human rejects target authorization", async () => {
    const ctx = context({ authorizeTarget: true }, async () => false)
    await expect(requireAuthorizedTarget(ctx, "https://example.test", "WebTest")).resolves.toBe(false)
    expect(ctx.output.join("\n")).toContain("cancelled")
  })

  test("WebTest run refuses unauthorized targets before opening a browser or network request", async () => {
    const ctx = context()
    ctx.args = ["https://example.test"]
    const command = webtest.commands.find((item) => item.name === "run")!
    await expect(command.run(ctx)).resolves.toBe(1)
    expect(ctx.errors.join("\n")).toContain("--authorize-target")
  })

  test("WebTest visual QA and recorder also refuse unauthorized targets", async () => {
    for (const name of ["visual", "record"]) {
      const ctx = context()
      ctx.args = ["https://example.test"]
      const command = webtest.commands.find((item) => item.name === name)!
      await expect(command.run(ctx)).resolves.toBe(1)
      expect(ctx.errors.join("\n")).toContain("--authorize-target")
    }
  })

  test("daemon commands do not create a watchdog or boot task", async () => {
    const ctx = context()
    const start = daemon.commands.find((item) => item.name === "start")!
    const autostart = daemon.commands.find((item) => item.name === "autostart")!
    await expect(start.run(ctx)).resolves.toBe(1)
    await expect(autostart.run(ctx)).resolves.toBe(1)
    expect(ctx.errors.join("\n")).toContain("Persistent daemon")
  })

  test("co-pilot launch options contain no automation-evasion flag", () => {
    expect(COPILOT_LAUNCH_ARGS.join(" ")).not.toContain("AutomationControlled")
  })

  test("remote deploy and destructive cPanel actions stop when human confirmation is denied", async () => {
    const denied = context({ name: "temporary_db" }, async () => false)
    const git = deploy.commands.find((item) => item.name === "git")!
    const deleteDatabase = cpanel.commands.find((item) => item.name === "db:delete")!
    await expect(git.run(denied)).resolves.toBe(0)
    await expect(deleteDatabase.run(denied)).resolves.toBe(1)
    expect(denied.errors.join("\n")).toContain("--confirm")
  })
})
