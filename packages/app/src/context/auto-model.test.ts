import { describe, expect, test } from "bun:test"
import { classifyTaskRequirements } from "./auto-model"

describe("local Auto Model task classification", () => {
  test("keeps ordinary chat unconstrained", () => {
    expect(classifyTaskRequirements("Explain TypeScript simply")).toEqual({
      tools: false,
      vision: false,
      longContext: false,
      reasoning: false,
    })
  })

  test("detects coding, screenshot, repository and reasoning requirements locally", () => {
    expect(classifyTaskRequirements("Analyze this screenshot and debug the multi-file repository architecture")).toEqual({
      tools: true,
      vision: true,
      longContext: true,
      reasoning: true,
    })
  })
})
