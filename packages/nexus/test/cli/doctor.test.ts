import { describe, expect, test } from "bun:test"
import { Doctor } from "../../src/cli/cmd/doctor"

type ResultOverrides = Partial<Pick<Doctor.CheckResult, "state" | "detail" | "hint">>

function result(name: string, overrides: ResultOverrides = {}): Doctor.CheckResult {
  return { name, state: "ok", detail: "fine", ...overrides }
}

function fakeIO(overrides: Partial<Doctor.DoctorIO> = {}): Doctor.DoctorIO {
  const base: Doctor.DoctorIO = {
    getEnv: () => undefined,
    platform: () => "linux",
    homeDir: () => "/home/tester",
    exists: async () => false,
    readTextFile: async () => "{}",
    commandExists: async () => true,
    runHelp: async () => true,
    ensureWritableDir: async () => true,
    freeBytes: async () => 2 * 1024 ** 3,
  }
  return { ...base, ...overrides }
}

function termuxEnv(values: Record<string, string> = {}) {
  return (key: string) =>
    ({
      PREFIX: "/data/data/com.termux/files/usr",
      TERMUX_VERSION: "0.118.0",
      ...values,
    })[key]
}

describe("doctor report rendering", () => {
  const results = [
    result("Alpha", { detail: "all good" }),
    result("Beta", { state: "fail", detail: "missing binary", hint: "Install Beta." }),
    result("Gamma", { state: "skip", detail: "not native Termux" }),
  ]

  test("renders pass, fail, and skip markers with aligned details", () => {
    const lines = Doctor.renderReport(results).split("\n")
    expect(lines[0]).toBe("NEXUS doctor")
    expect(lines[1]).toContain("✓")
    expect(lines[1]).toContain("Alpha — all good")
    expect(lines[2]).toContain("✗")
    expect(lines[3]).toContain("[skip]")
    expect(lines[1].indexOf("—")).toBe(lines[2].indexOf("—"))
  })

  test("lists hints only for non-ok checks that carry one", () => {
    const report = Doctor.renderReport(results)
    expect(report).toContain("Fixes:")
    expect(report).toContain("• Install Beta.")
    expect(report).not.toContain("not applicable hint")
  })

  test("omits the hints block when nothing needs fixing", () => {
    expect(Doctor.renderReport([result("Only")])).not.toContain("Fixes:")
  })
})

describe("doctor strict exit logic", () => {
  const allOk = [result("A"), result("B")]
  const withFail = [result("A"), result("B", { state: "fail" })]
  const skippedOnly = [result("A"), result("B", { state: "skip" })]

  test("always exits 0 without --strict", () => {
    expect(Doctor.resolveExitCode(withFail, false)).toBe(0)
  })

  test("exits 0 under --strict when only passes and skips remain", () => {
    expect(Doctor.resolveExitCode(allOk, true)).toBe(0)
    expect(Doctor.resolveExitCode(skippedOnly, true)).toBe(0)
  })

  test("exits 1 under --strict when any check fails", () => {
    expect(Doctor.resolveExitCode(withFail, true)).toBe(1)
  })
})

describe("doctor queue integrity", () => {
  test("reports corrupt JSON as invalid with zero counts", () => {
    const summary = Doctor.summarizeQueue("{not json at all")
    expect(summary.valid).toBe(false)
    expect(summary.pending).toBe(0)
    expect(summary.failed).toBe(0)
    expect(summary.problem).toContain("not valid JSON")
  })

  test("rejects unrecognized structures", () => {
    expect(Doctor.summarizeQueue('{"records":"nope"}').valid).toBe(false)
    expect(Doctor.summarizeQueue('"just a string"').valid).toBe(false)
  })

  test("counts pending and failed records in valid queues", () => {
    const queue = JSON.stringify([
      { state: "pending" },
      { status: "failed" },
      { state: "done" },
      { state: "failed" },
    ])
    expect(Doctor.summarizeQueue(queue)).toMatchObject({ valid: true, pending: 1, failed: 2 })
  })
})

describe("doctor provider counting", () => {
  test("counts unique provider ids across files without reading values", () => {
    const auth = '{"anthropic":{"KEY":"sk-super-secret-value"},"openai":{}}'
    const vault = '{"anthropic":{"nested":{"secret":"hunter2"}},"groq":[1,2]}'
    const counted = Doctor.countProviders([auth, vault])
    expect(counted.count).toBe(3)
    expect(counted.filesRead).toBe(2)
    expect(counted.count).toBe(Doctor.countProviders(["{}"]).count + 3)
  })

  test("ignores unreadable or non-object payloads", () => {
    expect(Doctor.countProviders([undefined, "nope{", "[1,2]"])).toEqual({ count: 0, filesRead: 0 })
  })

  test("vault check reports counts and never leaks secret values", async () => {
    const io = fakeIO({
      exists: async (path) => path.endsWith(".json"),
      readTextFile: async (path) =>
        path.endsWith("auth.json")
          ? '{"anthropic":{"token":"sk-live-classified-token"}}'
          : '{"openai":{"apiKey":"plain-hidden-key"}}',
    })
    const check = Doctor.createChecks(io).find((entry) => entry.name === "Vault and config")
    expect(check).toBeDefined()
    const outcome = await check!.run()
    const rendered = JSON.stringify(outcome)
    expect(rendered).not.toContain("sk-live-classified-token")
    expect(rendered).not.toContain("plain-hidden-key")
    expect(outcome.state).toBe("ok")
    expect(outcome.detail).toContain("2 configured provider(s)")
  })

  test("vault check fails closed when ~/.nexus is not writable", async () => {
    const io = fakeIO({ ensureWritableDir: async () => false })
    const outcome = (await Doctor.createChecks(io).find((c) => c.name === "Vault and config")!.run())!
    expect(outcome.state).toBe("fail")
    expect(outcome.hint).toContain("Create ~/.nexus")
  })
})

describe("doctor runtime detection", () => {
  test("detects native Termux via TERMUX_VERSION or com.termux prefix", () => {
    expect(Doctor.detectRuntime(termuxEnv({}), "linux").kind).toBe("termux-native")
    expect(Doctor.detectRuntime(() => "/rootfs/com.termux/files/usr", "linux").kind).toBe("termux-native")
  })

  test("detects PRoot distributions by prefix shape", () => {
    const prootEnv = (key: string) => (key === "PREFIX" ? "/data/termux/proot-distro/rootfs/bookworm" : undefined)
    expect(Doctor.detectRuntime(prootEnv, "linux").kind).toBe("termux-proot")
  })

  test("falls back to plain platform labels elsewhere", () => {
    expect(Doctor.detectRuntime(() => undefined, "darwin").label).toBe("macOS")
    expect(Doctor.detectRuntime(() => undefined, "win32").label).toBe("Windows")
    expect(Doctor.detectRuntime(() => undefined, "linux").label).toBe("Linux")
    expect(Doctor.detectRuntime(() => undefined, "freebsd").kind).toBe("other")
  })
})

describe("doctor check suite over injectable IO", () => {
  test("builds ten uniquely named checks that all resolve", async () => {
    const checks = Doctor.createChecks(fakeIO())
    const names = checks.map((check) => check.name)
    expect(names.length).toBe(10)
    expect(new Set(names).size).toBe(10)

    const results = await Doctor.runChecks(checks)
    expect(results.map((result) => result.name)).toEqual(names)
    for (const outcome of results) {
      expect(["ok", "fail", "skip"]).toContain(outcome.state)
      expect(typeof outcome.detail).toBe("string")
    }
  })

  test("marks runtime environment as informational pass everywhere", async () => {
    const desktop = await Doctor.createChecks(fakeIO()).find((c) => c.name === "Runtime environment")!.run()
    const mobile = await Doctor.createChecks(fakeIO({ getEnv: termuxEnv() })).find(
      (c) => c.name === "Runtime environment",
    )!.run()
    expect(desktop.state).toBe("ok")
    expect(mobile.state).toBe("ok")
    expect(mobile.detail).toContain("native Termux")
  })

  test("skips Termux-only checks on the desktop and runs them on Termux", async () => {
    const findOn = async (io: Doctor.DoctorIO, name: string) => {
      const outcome = await Doctor.createChecks(io).find((c) => c.name === name)!.run()
      return outcome.state
    }
    const desktop = fakeIO()
    const mobile = fakeIO({ getEnv: termuxEnv() })

    expect(await findOn(desktop, "Wake-lock helper")).toBe("skip")
    expect(await findOn(desktop, "Shared storage access")).toBe("skip")
    expect(await findOn(mobile, "Wake-lock helper")).toBe("ok")

    const noBootDir = fakeIO({ getEnv: termuxEnv(), exists: async (path) => !path.includes(".termux") })
    const bootOutcome = await Doctor.createChecks(noBootDir).find((c) => c.name === "Boot autostart directory")!.run()
    expect(bootOutcome.state).toBe("fail")
    expect(bootOutcome.hint).toContain("Termux:Boot")
  })

  test("fails when termux-api commands are absent on native Termux", async () => {
    const io = fakeIO({ getEnv: termuxEnv(), commandExists: async () => false, runHelp: async () => null })
    const packageOutcome = await Doctor.createChecks(io).find((c) => c.name === "termux-api package")!.run()
    const appOutcome = await Doctor.createChecks(io).find((c) => c.name === "Termux:API app")!.run()
    expect(packageOutcome.state).toBe("fail")
    expect(packageOutcome.hint).toContain("pkg i termux-api")
    expect(appOutcome.state).toBe("skip")
    expect(appOutcome.hint).toContain("Termux:API Android app")
  })

  test("handles missing, unreadable, and healthy queue files", async () => {
    const missing = fakeIO()
    expect((await Doctor.createChecks(missing).find((c) => c.name === "Task queue integrity")!.run()).detail).toContain(
      "no queue.json recorded",
    )

    const unreadable = fakeIO({ exists: async (path) => path.endsWith("queue.json") })
    const broken = await Doctor.createChecks(unreadable).find((c) => c.name === "Task queue integrity")!.run()
    expect(broken.state).toBe("fail")

    const healthy = fakeIO({
      exists: async (path) => path.endsWith("queue.json"),
      readTextFile: async () => '[{"state":"pending"},{"status":"failed"}]',
    })
    const good = await Doctor.createChecks(healthy).find((c) => c.name === "Task queue integrity")!.run()
    expect(good.state).toBe("ok")
    expect(good.detail).toContain("1 pending · 1 failed")
  })

  test("warns below 500 MB free disk space and skips unknown usage", async () => {
    const low = fakeIO({ freeBytes: async () => 400 * 1024 * 1024 })
    const lowOutcome = await Doctor.createChecks(low).find((c) => c.name === "Disk space on home")!.run()
    expect(lowOutcome.state).toBe("fail")
    expect(lowOutcome.hint).toContain("500 MB")

    const ample = fakeIO({ freeBytes: async () => 600 * 1024 * 1024 })
    const okOutcome = await Doctor.createChecks(ample).find((c) => c.name === "Disk space on home")!.run()
    expect(okOutcome.state).toBe("ok")

    const opaque = fakeIO({ freeBytes: async () => undefined })
    expect((await Doctor.createChecks(opaque).find((c) => c.name === "Disk space on home")!.run()).state).toBe("skip")
  })

  test("uses PREFIX tmp on Termux and /tmp/nexus elsewhere", async () => {
    const mobile = fakeIO({ getEnv: termuxEnv() })
    const desktop = fakeIO()
    const mobileOutcome = await Doctor.createChecks(mobile).find((c) => c.name === "Runtime tmp writable")!.run()
    const desktopOutcome = await Doctor.createChecks(desktop).find((c) => c.name === "Runtime tmp writable")!.run()
    expect(mobileOutcome.detail).toBe("/data/data/com.termux/files/usr/tmp/nexus")
    expect(desktopOutcome.detail).toBe("/tmp/nexus")
  })
})
