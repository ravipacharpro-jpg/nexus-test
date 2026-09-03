import { describe, expect, test } from "bun:test"
import { applyResourceLimits } from "../src/device"

describe("device resource defaults", () => {
  test("uses a current text-chat model for the medium tier", () => {
    expect(applyResourceLimits("medium").preferredModel).toBe("groq/openai/gpt-oss-120b")
  })
})
