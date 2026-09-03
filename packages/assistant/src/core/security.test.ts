import { PassThrough } from "node:stream"
import { describe, expect, test } from "bun:test"
import { createBufferedLineReader } from "./security"

describe("buffered confirmation input", () => {
  test("preserves a second piped confirmation delivered in the first stdin chunk", async () => {
    const stdin = new PassThrough()
    const readLine = createBufferedLineReader(stdin as any)

    const first = readLine()
    stdin.write("y\ny\n")

    expect(await first).toBe("y")
    expect(await readLine()).toBe("y")
  })
})
