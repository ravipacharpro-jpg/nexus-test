import { describe, expect, test } from "bun:test"
import {
  classifyTaskRequirements,
  supportsTaskRequirements,
  taskTextFromMessages,
} from "../../src/session/llm/capability"

const full = {
  capabilities: { toolcall: true, reasoning: true, attachment: true, input: { image: true } },
  limit: { context: 128_000 },
}

describe("local task capability routing", () => {
  test("classifies local capability requirements without remote requests", () => {
    expect(
      classifyTaskRequirements("Analyze this multi-file codebase, inspect screenshot, then implement and test a plan"),
    ).toEqual({
      tools: true,
      vision: true,
      longContext: true,
      reasoning: true,
    })
  })

  test("filters only known-incompatible fallback metadata while normal chat stays eligible", () => {
    expect(supportsTaskRequirements(full, classifyTaskRequirements("hello"))).toBe(true)
    expect(
      supportsTaskRequirements(
        {
          capabilities: { toolcall: false, reasoning: false, attachment: false, input: { image: false } },
          limit: { context: 8_000 },
        },
        classifyTaskRequirements("inspect image and reason about a large codebase"),
      ),
    ).toBe(false)
  })

  test("extracts local text only from model messages without preserving non-text payloads", () => {
    expect(
      taskTextFromMessages([
        { content: "fix code" },
        {
          content: [
            { type: "text", text: "and test it" },
            { type: "image", image: "ignored" },
          ],
        },
      ]),
    ).toBe("fix code\nand test it")
  })
})
