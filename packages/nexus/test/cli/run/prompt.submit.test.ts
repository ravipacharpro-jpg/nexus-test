import { isPlainPromptSubmitKey } from "@/cli/cmd/run/prompt.submit"

describe("prompt submit key handling", () => {
  test("accepts plain Return and Enter keys", () => {
    expect(isPlainPromptSubmitKey({ name: "return" })).toBe(true)
    expect(isPlainPromptSubmitKey({ name: "ENTER" })).toBe(true)
  })

  test("keeps modified Return combinations available for newline input", () => {
    expect(isPlainPromptSubmitKey({ name: "return", shift: true })).toBe(false)
    expect(isPlainPromptSubmitKey({ name: "return", ctrl: true })).toBe(false)
    expect(isPlainPromptSubmitKey({ name: "return", alt: true })).toBe(false)
    expect(isPlainPromptSubmitKey({ name: "return", meta: true })).toBe(false)
    expect(isPlainPromptSubmitKey({ name: "return", super: true })).toBe(false)
    expect(isPlainPromptSubmitKey({ name: "space" })).toBe(false)
  })
})
