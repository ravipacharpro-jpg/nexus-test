import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startLocalWebServer } from "./local-web"

describe("local web server lifecycle", () => {
  test("starts, health-checks, and stops a localhost server", async () => {
    const root = await mkdtemp(join(tmpdir(), "nexus-local-web-"))
    const port = 32_000 + Math.floor(Math.random() * 1_000)
    const server = await startLocalWebServer({
      command: ["python3", "-m", "http.server", String(port), "--bind", "127.0.0.1"],
      cwd: root,
      port,
      startupTimeoutMs: 5_000,
    })

    expect(server.url).toBe(`http://127.0.0.1:${port}/`)
    expect((await server.health()).status).toBe(200)
    await server.stop()
  })

  test("rejects non-local health targets before spawning", async () => {
    await expect(
      startLocalWebServer({
        command: ["python3"],
        cwd: process.cwd(),
        port: 3000,
        host: "evil.test",
      }),
    ).rejects.toThrow("localhost")
  })
})
