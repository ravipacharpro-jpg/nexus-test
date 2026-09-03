import { describe, expect, test } from "bun:test"
import { generateSpec } from "./webtest"

describe("screen-to-code recorder spec generation", () => {
  test("password fills are masked, never recorded raw", () => {
    const spec = generateSpec("https://example.com", [
      { action: "goto", value: "https://example.com" },
      { action: "fill", selector: "input[name='pass']", value: "***" },
    ])
    expect(spec).toContain("page.goto('https://example.com')")
    expect(spec).toContain("'***'")
  })

  test("special characters in selectors/values are escaped", () => {
    const spec = generateSpec("https://x.test", [
      { action: "click", selector: "text=Login'now" },
    ])
    expect(spec).toContain("text=Login\\'now")
  })

  test("goto steps render full navigation", () => {
    const spec = generateSpec("https://a.b", [
      { action: "goto", value: "https://a.b/login" },
      { action: "click", selector: "#submit" },
    ])
    expect(spec.match(/await page\./g)?.length).toBe(2)
  })
})
