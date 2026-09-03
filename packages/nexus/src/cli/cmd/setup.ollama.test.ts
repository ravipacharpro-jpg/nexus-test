import { expect, test } from "bun:test"
import { ollamaInstallPlan } from "./setup"

test("selects an explicit installer only for supported package-manager environments", () => {
  expect(ollamaInstallPlan("termux").command).toEqual(["pkg", "install", "-y", "ollama"])
  expect(ollamaInstallPlan("macos").command).toEqual(["brew", "install", "ollama"])
  expect(ollamaInstallPlan("windows").command).toEqual(["winget", "install", "Ollama.Ollama"])
  expect(ollamaInstallPlan("linux").command).toBeUndefined()
  expect(ollamaInstallPlan("wsl").message).toContain("does not execute remote installer scripts")
  expect(ollamaInstallPlan("proot").command).toBeUndefined()
  expect(ollamaInstallPlan("andronix").command).toBeUndefined()
  expect(ollamaInstallPlan("userland").command).toBeUndefined()
})
