import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { WorkerRequest } from "../agent/master"
import { createMasterWorkerRegistry } from "./worker-registry"

function request(
  kind: WorkerRequest["step"]["kind"],
  workspace: string,
  objective = "inspect",
  capabilityOverrides: Partial<WorkerRequest["capabilities"]> = {},
) {
  return {
    taskID: "task-1",
    step: { id: kind, kind, title: objective, status: "dispatching", dependsOn: [], attempts: 1, maxAttempts: 2 },
    objective,
    workspace,
    queuedInstructions: [],
    capabilities: {
      platform: "linux",
      architecture: "x64",
      termux: false,
      git: true,
      github: false,
      browserHandoff: true,
      browserHttpInspection: false,
      browserAutomation: false,
      webRuntime: true,
      android: false,
      androidDevice: false,
      apkBuild: false,
      packageManagers: ["bun"],
      ...capabilityOverrides,
    },
  } satisfies WorkerRequest
}

describe("Master worker registry", () => {
  test("runs the default fixed-argument Git inspection adapter", async () => {
    const registry = createMasterWorkerRegistry()
    const result = await registry.run(request("git", process.cwd()))

    expect(result.summary).toMatch(/Git working tree is clean|changed file/)
    expect(result.verification).toContain("Only read-only inspection was requested by this worker.")
  })

  test("inspects GitHub metadata only when the capability is enabled", async () => {
    let called = false
    const registry = createMasterWorkerRegistry({
      inspectGit: async () => ({ branch: "main", clean: true, changedFiles: [], summary: "Repository inspected" }),
      inspectGitHub: async () => {
        called = true
        return {
          repository: "itzgeniusboy/nexus-fixed",
          defaultBranch: "main",
          authenticated: true,
          summary: "GitHub repository inspected: itzgeniusboy/nexus-fixed",
        }
      },
    })
    const result = await registry.run(request("git", process.cwd(), "inspect GitHub", { github: true }))

    expect(called).toBe(true)
    expect(result.verification).toContain("Repository: itzgeniusboy/nexus-fixed")
    expect(result.next).toContain("GitHub CLI is detected; external mutations still require explicit approval.")
  })

  test("runs typed read-only Git inspection and reports approval boundary", async () => {
    const registry = createMasterWorkerRegistry({
      inspectGit: async () => ({ branch: "main", clean: true, changedFiles: [], summary: "Repository inspected" }),
    })
    const result = await registry.run(request("git", process.cwd()))

    expect(result.summary).toBe("Repository inspected")
    expect(result.verification).toContain("Only read-only inspection was requested by this worker.")
  })

  test("routes sensitive browser work to user takeover and blocks until resumed", async () => {
    const registry = createMasterWorkerRegistry({
      runBrowserSession: async (input) => ({
        state: "awaiting_user",
        message: `Takeover required for ${input.url}`,
        url: input.url,
      }),
    })
    const result = await registry.run(
      request("browser", process.cwd(), "log in at https://example.com/login", { browserAutomation: true }),
    )

    expect(result.status).toBe("blocked")
    expect(result.summary).toMatch(/Takeover required/i)
    expect(result.verification).toContain("Browser session state: awaiting_user.")
    expect(result.receipts?.[0]?.exitCode).toBe(1)
    expect(result.next?.[0]).toMatch(/takeover/i)
  })

  test("does not execute browser automation when capability is unavailable", async () => {
    let called = false
    const registry = createMasterWorkerRegistry({
      inspectBrowser: async () => {
        called = true
        return { url: "https://example.com", summary: "inspected" }
      },
    })
    const result = await registry.run(request("browser", process.cwd(), "inspect https://example.com"))

    expect(called).toBe(false)
    expect(result.summary).toMatch(/unavailable/i)
  })

  test("records connected Android device evidence before project checks", async () => {
    const root = await mkdtemp(join(tmpdir(), "nexus-registry-device-"))
    await writeFile(
      join(root, "build.gradle"),
      "plugins { id 'com.android.application' version '8.0.0' apply false }\\n",
    )
    const registry = createMasterWorkerRegistry({
      inspectAndroidDevice: async () => ({ connected: true, state: "device", summary: "Pixel test device is ready." }),
      runProjectChecks: async (input) => input.commands.map((command) => ({ command, exitCode: 0 })),
    })
    const result = await registry.run(
      request("android", root, "run Android checks", { android: true, androidDevice: true }),
    )

    expect(result.status).toBe("completed")
    expect(result.verification).toContain("Device: Pixel test device is ready.")
  })

  test("skips Android connected checks without a device", async () => {
    const root = await mkdtemp(join(tmpdir(), "nexus-registry-android-"))
    await writeFile(
      join(root, "build.gradle"),
      "plugins { id 'com.android.application' version '8.0.0' apply false }\n",
    )
    let commands: readonly string[] = []
    const registry = createMasterWorkerRegistry({
      runProjectChecks: async (input) => {
        commands = input.commands
        return input.commands.map((command) => ({ command, exitCode: 0 }))
      },
    })
    const result = await registry.run(
      request("android", root, "run Android checks", { android: true, apkBuild: true, androidDevice: false }),
    )

    expect(commands).toEqual(["./gradlew test", "./gradlew assembleDebug", "./gradlew assembleRelease"])
    expect(result.verification).toContain("Skipped without a connected Android device: ./gradlew connectedCheck")
  })

  test("surfaces generated Android artifacts after successful checks", async () => {
    const root = await mkdtemp(join(tmpdir(), "nexus-registry-artifact-"))
    await writeFile(
      join(root, "build.gradle"),
      "plugins { id 'com.android.application' version '8.0.0' apply false }\\n",
    )
    await mkdir(join(root, "build", "outputs", "apk"), { recursive: true })
    await writeFile(join(root, "build", "outputs", "apk", "app-debug.apk"), "apk")
    const registry = createMasterWorkerRegistry({
      runProjectChecks: async (input) => input.commands.map((command) => ({ command, exitCode: 0 })),
    })
    const result = await registry.run(request("android", root, "run Android checks", { android: true, apkBuild: true }))

    expect(result.status).toBe("completed")
    expect(result.artifacts).toEqual(["build/outputs/apk/app-debug.apk"])
    expect(result.verification).toContain("Artifact: build/outputs/apk/app-debug.apk")
  })

  test("blocks failed project checks and preserves nonzero receipts", async () => {
    const root = await mkdtemp(join(tmpdir(), "nexus-registry-web-failure-"))
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ scripts: { test: "vitest" }, dependencies: { vite: "latest" } }),
    )
    const registry = createMasterWorkerRegistry({
      runProjectChecks: async (input) =>
        input.commands.map((command) => ({ command, exitCode: 1, output: "test failed" })),
    })
    const result = await registry.run(request("web", root, "run web checks"))

    expect(result.status).toBe("blocked")
    expect(result.summary).toMatch(/repair is required/i)
    expect(result.receipts?.[0]?.exitCode).toBe(1)
    expect(result.next?.[0]).toMatch(/repair/i)
  })

  test("dispatches only detected project checks through the typed operation", async () => {
    const root = await mkdtemp(join(tmpdir(), "nexus-registry-web-"))
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ scripts: { test: "vitest", build: "vite build" }, dependencies: { vite: "latest" } }),
    )
    let commands: readonly string[] = []
    const registry = createMasterWorkerRegistry({
      runProjectChecks: async (input) => {
        commands = input.commands
        return input.commands.map((command) => ({ command, exitCode: 0 }))
      },
    })
    const result = await registry.run(request("web", root, "run web checks"))

    expect(commands).toEqual(["npm run test", "npm run build"])
    expect(result.summary).toBe("web checks completed successfully.")
  })
})
