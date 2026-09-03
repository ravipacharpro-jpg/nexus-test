import { isSelfUpdateSafeToAutoPrepare, planSelfUpdate } from "./self-update"

describe("native self-update planning", () => {
  test("plans a newer release with backup and atomic health-gated activation", () => {
    const plan = planSelfUpdate({
      currentVersion: "1.2.3",
      latestVersion: "1.3.0",
      method: "curl",
      platform: "linux",
      architecture: "x64",
      installPath: "/home/user/.nexus/bin/nexus",
    })
    expect(plan.available).toBe(true)
    expect(plan.backupPath).toBe("/home/user/.nexus/bin/nexus.previous")
    expect(plan.activation).toBe("atomic_after_health_check")
    expect(plan.steps).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/backup/i),
        expect.stringMatching(/health/i),
        expect.stringMatching(/restore/i),
      ]),
    )
    expect(isSelfUpdateSafeToAutoPrepare(plan)).toBe(true)
  })

  test("does not update when the installed version is current or newer", () => {
    const plan = planSelfUpdate({ currentVersion: "2.0.0", latestVersion: "1.9.9", method: "npm" })
    expect(plan.available).toBe(false)
    expect(plan.steps).toEqual([])
    expect(plan.activation).toBe("not_required")
    expect(isSelfUpdateSafeToAutoPrepare(plan)).toBe(false)
  })

  test("rejects non-semver release values", () => {
    expect(() => planSelfUpdate({ currentVersion: "dev", latestVersion: "1.0.0", method: "bun" })).toThrow(
      /numeric semver/i,
    )
  })
})
