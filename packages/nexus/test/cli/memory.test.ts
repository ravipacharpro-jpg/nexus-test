import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  addLocalMemory,
  containsSensitiveMemoryValue,
  formatMemoryList,
  getLocalMemory,
  listLocalMemories,
  MEMORY_METADATA_EXPORT,
  memoryStatus,
  removeLocalMemory,
  searchLocalMemoryTitles,
  updateLocalMemory,
  writeMemoryMetadataExport,
} from "../../src/cli/cmd/memory"

describe("local permanent memory", () => {
  test("creates memory only from an explicit bounded add and lists newest entries first", () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "nexus-memory-"))
    try {
      expect(memoryStatus(stateDirectory)).toMatchObject({ initialized: false, entries: 0 })
      const older = addLocalMemory({ stateDirectory, title: "project preference", value: "Prefer tests before merge", createdAt: 1 })
      const newer = addLocalMemory({ stateDirectory, title: "device note", value: "Use Termux command-first ergonomics", createdAt: 2 })

      expect(memoryStatus(stateDirectory)).toMatchObject({ initialized: true, entries: 2 })
      expect(listLocalMemories({ stateDirectory, limit: 1 })).toEqual([newer])
      expect(listLocalMemories({ stateDirectory })).toEqual([newer, older])
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true })
    }
  })

  test("rejects sensitive-looking additions before persistence and redacts defensive display output", () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "nexus-memory-"))
    try {
      expect(containsSensitiveMemoryValue("password=correct-horse-battery-staple")).toBe(true)
      expect(containsSensitiveMemoryValue("NEXUS_TOKEN=private-token-value-123456")).toBe(true)
      expect(() => addLocalMemory({ stateDirectory, title: "credential", value: "password=correct-horse-battery-staple" })).toThrow(
        "looks sensitive",
      )
      expect(listLocalMemories({ stateDirectory })).toEqual([])
      expect(
        formatMemoryList([{ id: 1, title: "manual", value: "Bearer private-token-value-123456", createdAt: 1 }], "table"),
      ).toContain("[redacted: sensitive-looking value]")
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true })
    }
  })

  test("shows one memory without mutation and removes only one confirmed positive ID", () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "nexus-memory-"))
    try {
      const first = addLocalMemory({ stateDirectory, title: "first", value: "keep this", createdAt: 1 })
      const second = addLocalMemory({ stateDirectory, title: "second", value: "remove this", createdAt: 2 })

      expect(getLocalMemory({ stateDirectory, id: second.id })).toEqual(second)
      expect(() => removeLocalMemory({ stateDirectory, id: second.id, confirmed: false })).toThrow("requires --confirm")
      expect(listLocalMemories({ stateDirectory })).toEqual([second, first])
      expect(removeLocalMemory({ stateDirectory, id: second.id, confirmed: true })).toEqual(second)
      expect(getLocalMemory({ stateDirectory, id: second.id })).toBeUndefined()
      expect(listLocalMemories({ stateDirectory })).toEqual([first])
      expect(() => getLocalMemory({ stateDirectory, id: 0 })).toThrow("positive integer")
      expect(removeLocalMemory({ stateDirectory, id: 999, confirmed: true })).toBeUndefined()
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true })
    }
  })

  test("does not create local storage when a bounded show or remove target is absent", () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "nexus-memory-"))
    try {
      expect(getLocalMemory({ stateDirectory, id: 1 })).toBeUndefined()
      expect(removeLocalMemory({ stateDirectory, id: 1, confirmed: true })).toBeUndefined()
      expect(() => removeLocalMemory({ stateDirectory, id: 1, confirmed: false })).toThrow("requires --confirm")
      expect(memoryStatus(stateDirectory)).toMatchObject({ initialized: false, entries: 0 })
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true })
    }
  })

  test("updates exactly one confirmed ID while preserving creation time and other entries", () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "nexus-memory-"))
    try {
      const first = addLocalMemory({ stateDirectory, title: "first", value: "keep first", createdAt: 1 })
      const second = addLocalMemory({ stateDirectory, title: "second", value: "keep second", createdAt: 2 })

      expect(() => updateLocalMemory({ stateDirectory, id: first.id, title: "updated", value: "changed", confirmed: false })).toThrow(
        "requires --confirm",
      )
      expect(() => updateLocalMemory({ stateDirectory, id: first.id, title: "credential", value: "password=not-allowed", confirmed: true })).toThrow(
        "looks sensitive",
      )
      expect(getLocalMemory({ stateDirectory, id: first.id })).toEqual(first)
      expect(updateLocalMemory({ stateDirectory, id: first.id, title: "updated", value: "changed", confirmed: true })).toEqual({
        id: first.id,
        title: "updated",
        value: "changed",
        createdAt: first.createdAt,
      })
      expect(getLocalMemory({ stateDirectory, id: second.id })).toEqual(second)
      expect(updateLocalMemory({ stateDirectory, id: 999, title: "missing", value: "missing", confirmed: true })).toBeUndefined()
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true })
    }
  })

  test("searches bounded titles only and never matches or displays memory values", () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "nexus-memory-"))
    try {
      const titleMatch = addLocalMemory({ stateDirectory, title: "Project preference", value: "value must stay private", createdAt: 1 })
      addLocalMemory({ stateDirectory, title: "Device note", value: "project appears only in this value", createdAt: 2 })

      expect(searchLocalMemoryTitles({ stateDirectory, query: "project" })).toEqual([
        { id: titleMatch.id, title: titleMatch.title, createdAt: titleMatch.createdAt },
      ])
      expect(searchLocalMemoryTitles({ stateDirectory, query: "private" })).toEqual([])
      expect(() => searchLocalMemoryTitles({ stateDirectory, query: "password=not-searchable" })).toThrow("looks sensitive")
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true })
    }
  })

  test("writes only a confirmed fixed-name metadata export and never overwrites or includes values", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "nexus-memory-"))
    try {
      const entry = addLocalMemory({ stateDirectory, title: "Project preference", value: "value must never be exported", createdAt: 1 })
      const path = join(stateDirectory, MEMORY_METADATA_EXPORT)

      await expect(writeMemoryMetadataExport({ stateDirectory, confirmed: false })).rejects.toThrow("requires --confirm")
      expect(existsSync(path)).toBe(false)
      await expect(writeMemoryMetadataExport({ stateDirectory, confirmed: true, exportedAt: 2 })).resolves.toEqual({ path, entries: 1 })
      const exported = readFileSync(path, "utf8")
      expect(exported).toContain('"kind": "nexus-local-memory-metadata"')
      expect(exported).toContain(`"id": ${entry.id}`)
      expect(exported).toContain(entry.title)
      expect(exported).not.toContain(entry.value)
      expect(exported).not.toContain('"value"')
      await expect(writeMemoryMetadataExport({ stateDirectory, confirmed: true })).rejects.toThrow("not overwritten")
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true })
    }
  })
})
