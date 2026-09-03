import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { formatArtifactInspection, inspectAuthorizedArtifact } from "../../src/cli/cmd/artifact"

const temporary: string[] = []

function zipFixture(entries: Array<{ name: string; contents: string }>): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const contents = Buffer.from(entry.contents)
    const local = Buffer.alloc(30 + name.length + contents.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(contents.length, 18)
    local.writeUInt32LE(contents.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    name.copy(local, 30)
    contents.copy(local, 30 + name.length)
    locals.push(local)

    const directory = Buffer.alloc(46 + name.length)
    directory.writeUInt32LE(0x02014b50, 0)
    directory.writeUInt16LE(20, 4)
    directory.writeUInt16LE(20, 6)
    directory.writeUInt16LE(0, 8)
    directory.writeUInt16LE(0, 10)
    directory.writeUInt32LE(0, 16)
    directory.writeUInt32LE(contents.length, 20)
    directory.writeUInt32LE(contents.length, 24)
    directory.writeUInt16LE(name.length, 28)
    directory.writeUInt16LE(0, 30)
    directory.writeUInt16LE(0, 32)
    directory.writeUInt32LE(0, 42)
    directory.writeUInt32LE(offset, 42)
    name.copy(directory, 46)
    central.push(directory)
    offset += local.length
  }
  const centralBuffer = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuffer, end])
}

function fixture(extension: "apk" | "obb" | "pak", contents?: Buffer) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-artifact-"))
  temporary.push(root)
  const target = path.join(root, `authorized.${extension}`)
  fs.writeFileSync(target, contents ?? Buffer.from("PAK\u0000metadata-only"))
  return target
}

afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe("authorized Android artifact inspection", () => {
  test("reads bounded APK central-directory metadata without extraction or raw credential-like entry names", async () => {
    const target = fixture(
      "apk",
      zipFixture([
        { name: "AndroidManifest.xml", contents: "manifest" },
        { name: "assets/api_key_supersecret.txt", contents: "not read" },
      ]),
    )
    const inspection = await inspectAuthorizedArtifact(target)

    expect(inspection).toMatchObject({ kind: "apk", archive: true, inventoryTruncated: false })
    expect(inspection.inventory.map((entry) => entry.name)).toContain("AndroidManifest.xml")
    expect(inspection.inventory.map((entry) => entry.name).join("\n")).not.toContain("supersecret")
    expect(formatArtifactInspection(inspection, "table")).toContain("No extraction, execution")
  })

  test("treats PAK as metadata-only and rejects unsupported paths or symbolic links", async () => {
    const pak = fixture("pak")
    const inspection = await inspectAuthorizedArtifact(pak)
    expect(inspection).toMatchObject({ kind: "pak", archive: false, inventory: [] })

    const unsupported = path.join(path.dirname(pak), "unsupported.bin")
    fs.writeFileSync(unsupported, "x")
    await expect(inspectAuthorizedArtifact(unsupported)).rejects.toThrow("Supported artifact extensions")

    const linked = path.join(path.dirname(pak), "linked.apk")
    fs.symlinkSync(pak, linked)
    await expect(inspectAuthorizedArtifact(linked)).rejects.toThrow("Symbolic links")
  })
})
