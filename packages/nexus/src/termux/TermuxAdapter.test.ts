import { expect, test } from "bun:test"
import { packageManagerForEnvironment } from "./TermuxAdapter"

test("uses package managers appropriate to the detected runtime family", () => {
  expect(packageManagerForEnvironment("termux")).toBe("pkg")
  expect(packageManagerForEnvironment("proot")).toBe("apt")
  expect(packageManagerForEnvironment("andronix")).toBe("apt")
  expect(packageManagerForEnvironment("userland")).toBe("apt")
  expect(packageManagerForEnvironment("wsl")).toBe("apt")
  expect(packageManagerForEnvironment("macos")).toBe("brew")
  expect(packageManagerForEnvironment("windows")).toBe("winget")
  expect(packageManagerForEnvironment("linux")).toBe("apt")
})
