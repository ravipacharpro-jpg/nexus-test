import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { detectProjectTargets } from "./project-targets"

describe("project target detection", () => {
  test("detects a Vite-style web project and uses its lockfile manager", async () => {
    const root = await mkdtemp(join(tmpdir(), "nexus-web-target-"))
    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\n")
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        scripts: { dev: "vite", test: "vitest", build: "vite build" },
        dependencies: { react: "^19.0.0" },
      }),
    )

    expect(detectProjectTargets(root)).toEqual([
      {
        kind: "web",
        root,
        packageManager: "pnpm",
        runCommands: ["pnpm run dev"],
        testCommands: ["pnpm run test"],
        buildCommands: ["pnpm run build"],
      },
    ])
  })

  test("detects Android package metadata without guessing missing values", async () => {
    const root = await mkdtemp(join(tmpdir(), "nexus-android-package-"))
    await mkdir(join(root, "app"))
    await writeFile(join(root, "settings.gradle"), "include ':app'\n")
    await writeFile(
      join(root, "app", "build.gradle"),
      'android { namespace "com.example.demo"; defaultConfig { applicationId "com.example.demo" } }\n',
    )

    const target = detectProjectTargets(root).find((item) => item.kind === "android")
    expect(target?.packageName).toBe("com.example.demo")
  })

  test("detects Android build files and preserves package target", async () => {
    const root = await mkdtemp(join(tmpdir(), "nexus-android-target-"))
    await mkdir(join(root, "app"))
    await writeFile(join(root, "settings.gradle"), "include ':app'\n")
    await writeFile(join(root, "app", "build.gradle"), "plugins { id 'com.android.application' }\n")
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "jest" } }))

    const targets = detectProjectTargets(root)
    expect(targets[0]?.kind).toBe("android")
    expect(targets[0]?.testCommands).toEqual(["./gradlew test", "./gradlew connectedCheck"])
    expect(targets[1]?.kind).toBe("node")
    expect(targets[1]?.testCommands).toEqual(["npm run test"])
  })
})
