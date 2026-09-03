import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { outputDirectoryIsEmpty } from "./codegen"
import { isDirectory } from "./deploy"
import { recoverySaveRequest } from "./recovery"

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("safe local write guards", () => {
  test("code generation detects existing project contents before a write", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nexus-codegen-"))
    cleanup.push(dir)
    expect(await outputDirectoryIsEmpty(dir)).toEqual({ empty: true, exists: true })
    await writeFile(path.join(dir, "package.json"), '{"name":"existing"}')
    expect(await outputDirectoryIsEmpty(dir)).toEqual({ empty: false, exists: true })
  })

  test("SSH deploy accepts a real directory and rejects a missing path", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nexus-deploy-"))
    cleanup.push(dir)
    await mkdir(path.join(dir, "dist"))
    expect(await isDirectory(path.join(dir, "dist"))).toBe(true)
    expect(await isDirectory(path.join(dir, "missing"))).toBe(false)
  })

  test("recovery treats its documented first positional argument as the snapshot name", () => {
    expect(recoverySaveRequest(["save", "before-refactor"], {})).toEqual({ name: "before-refactor" })
    expect(recoverySaveRequest(["save"], { name: "release" })).toEqual({ name: "release" })
    expect(recoverySaveRequest(["save", "before-refactor"], { path: "../project" })).toEqual({ project: "../project", name: "before-refactor" })
  })

  test("recovery ignores a legacy command token when one is supplied by an older dispatcher", () => {
    expect(recoverySaveRequest(["save"], {})).toEqual({})
  })
})
