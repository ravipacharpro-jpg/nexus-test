import { expect, test } from "bun:test"
import { detectRuntimeEnvironment, isNativeTermux, runtimeTempDirectory, type RuntimeProbe } from "./platform"

const probe = (overrides: Partial<RuntimeProbe> = {}): RuntimeProbe => ({
  env: {},
  platform: "linux",
  release: "6.8.0",
  home: "/home/nexus",
  exists: () => false,
  ...overrides,
})

test("classifies native Termux and keeps container runtimes out of native Termux mode", () => {
  expect(detectRuntimeEnvironment(probe({ env: { TERMUX_VERSION: "0.118" } }))).toBe("termux")
  expect(detectRuntimeEnvironment(probe({ env: { PREFIX: "/data/data/com.termux/files/usr", PROOT_DISTRO: "debian" } }))).toBe("proot")
  expect(detectRuntimeEnvironment(probe({ env: { ANDRONIX_APP: "1" } }))).toBe("andronix")
  expect(detectRuntimeEnvironment(probe({ env: { USERLAND_APP: "1" } }))).toBe("userland")
  expect(isNativeTermux(probe({ env: { PREFIX: "/data/data/com.termux/files/usr", PROOT_DISTRO: "ubuntu" } }))).toBeFalse()
})

test("classifies desktop runtime families without Android assumptions", () => {
  expect(detectRuntimeEnvironment(probe({ env: { WSL_DISTRO_NAME: "Ubuntu" } }))).toBe("wsl")
  expect(detectRuntimeEnvironment(probe({ platform: "darwin" }))).toBe("macos")
  expect(detectRuntimeEnvironment(probe({ platform: "win32" }))).toBe("windows")
  expect(detectRuntimeEnvironment(probe())).toBe("linux")
})

test("uses the writable PREFIX tmp directory only for native Termux", () => {
  expect(runtimeTempDirectory(probe({ env: { PREFIX: "/data/data/com.termux/files/usr", TERMUX_VERSION: "0.118" } }))).toBe(
    "/data/data/com.termux/files/usr/tmp",
  )
  expect(runtimeTempDirectory(probe({ env: { PREFIX: "/data/data/com.termux/files/usr", PROOT_DISTRO: "debian" } }))).toBe("/tmp")
  expect(runtimeTempDirectory(probe({ env: { TMPDIR: "/custom/tmp" } }))).toBe("/custom/tmp")
})
