// @ts-nocheck -- this file is executed by Bun's test runner; production code remains type-checked separately.
import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ServiceManager } from "./ServiceManager"

test("rejects Android service commands outside native Termux", async () => {
  const originalPrefix = process.env.PREFIX
  const originalVersion = process.env.TERMUX_VERSION
  delete process.env.PREFIX
  delete process.env.TERMUX_VERSION
  try {
    await expect(new ServiceManager().acquireWakeLock()).rejects.toThrow("native Termux")
  } finally {
    if (originalPrefix === undefined) delete process.env.PREFIX
    else process.env.PREFIX = originalPrefix
    if (originalVersion === undefined) delete process.env.TERMUX_VERSION
    else process.env.TERMUX_VERSION = originalVersion
  }
})

test("boot helper documents best-effort wake locking instead of promising background survival", () => {
  const originalHome = process.env.HOME
  const originalVersion = process.env.TERMUX_VERSION
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-boot-test-"))
  process.env.TERMUX_VERSION = "0.118"
  process.env.HOME = home
  try {
    const result = new ServiceManager().enableBootStart()
    const script = fs.readFileSync(result.path, "utf8")
    expect(script).toContain("termux-wake-lock")
    expect(script).toContain("exec nexus serve")
    expect(result.message).toContain("best effort")
  } finally {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    if (originalVersion === undefined) delete process.env.TERMUX_VERSION
    else process.env.TERMUX_VERSION = originalVersion
  }
})
