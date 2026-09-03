import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { applyPreparedSelfUpdate } from "./self-update-runtime"
import { planSelfUpdate } from "./self-update"

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "nexus-self-update-"))
  const installPath = join(root, "bin", "nexus")
  await mkdir(join(root, "bin"), { recursive: true })
  const preparedBinaryPath = join(root, "prepared-nexus")
  const plan = planSelfUpdate({ currentVersion: "1.0.0", latestVersion: "1.1.0", method: "curl", installPath })
  return { root, installPath, preparedBinaryPath, plan }
}

describe("native self-update runtime", () => {
  test("activates a prepared binary after a passing health check", async () => {
    const { installPath, preparedBinaryPath, plan } = await fixture()
    await writeFile(installPath, "old")
    await writeFile(preparedBinaryPath, "new")
    const result = await applyPreparedSelfUpdate({
      plan,
      installPath,
      preparedBinaryPath,
      healthCheck: async () => true,
    })
    expect(result.activated).toBe(true)
    expect(result.rolledBack).toBe(false)
    expect(await readFile(installPath, "utf8")).toBe("new")
  })

  test("rolls back the previous binary when health verification fails", async () => {
    const { installPath, preparedBinaryPath, plan } = await fixture()
    await writeFile(installPath, "old")
    await writeFile(preparedBinaryPath, "bad")
    const result = await applyPreparedSelfUpdate({
      plan,
      installPath,
      preparedBinaryPath,
      healthCheck: async () => false,
    })
    expect(result.activated).toBe(false)
    expect(result.rolledBack).toBe(true)
    expect(await readFile(installPath, "utf8")).toBe("old")
  })

  test("refuses an absent prepared binary before touching the installation", async () => {
    const { installPath, preparedBinaryPath, plan } = await fixture()
    await writeFile(installPath, "old")
    await expect(
      applyPreparedSelfUpdate({ plan, installPath, preparedBinaryPath, healthCheck: async () => true }),
    ).rejects.toThrow(/prepared.*does not exist/i)
    expect(await readFile(installPath, "utf8")).toBe("old")
  })
})
