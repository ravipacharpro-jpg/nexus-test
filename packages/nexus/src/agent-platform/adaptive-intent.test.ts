import { classifyAdaptiveIntent, createRequirementMemory, reviseRequirementMemory } from "./adaptive-intent"

const capabilities = {
  platform: "linux",
  architecture: "x64",
  termux: false,
  git: true,
  github: true,
  browserHandoff: true,
  browserHttpInspection: true,
  browserAutomation: false,
  webRuntime: true,
  android: true,
  androidDevice: false,
  apkBuild: true,
  packageManagers: ["bun"],
} as const

describe("adaptive intent", () => {
  test("derives coordinated web, browser, and bug-fix workers", () => {
    const intent = classifyAdaptiveIntent("Test my website buttons and fix broken login UI", capabilities)
    expect(intent.kind).toBe("web_testing")
    expect(intent.requestedWorkers).toEqual(expect.arrayContaining(["browser", "web", "coder", "reviewer", "tester"]))
    expect(intent.requiresUserTakeover).toBe(true)
    expect(intent.capabilityGaps).toEqual([])
  })

  test("reports capability gaps instead of claiming unsupported Android work", () => {
    const intent = classifyAdaptiveIntent("Build and test the APK on Android", { ...capabilities, android: false })
    expect(intent.kind).toBe("android_testing")
    expect(intent.capabilityGaps).toContain("Android tooling")
  })

  test("keeps revisions and constraints as safe requirement memory", () => {
    const memory = reviseRequirementMemory(
      createRequirementMemory("Improve this app"),
      "It must work on Termux and never store passwords; add UI testing",
    )
    expect(memory.revisions).toHaveLength(1)
    expect(memory.requirements[0]).toContain("must work")
    expect(memory.constraints[0]).toContain("Termux")
    expect(memory.objective).toContain("UI testing")
  })
})
