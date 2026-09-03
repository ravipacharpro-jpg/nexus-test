import { capabilitySummary, detectAgentCapabilities } from "./capabilities"

describe("agent capabilities", () => {
  test("detects Termux from environment markers", () => {
    const capabilities = detectAgentCapabilities({
      TERMUX_VERSION: "0.119",
      PREFIX: "/data/data/com.termux/files/usr",
      PATH: "",
    })

    expect(capabilities.termux).toBe(true)
    expect(capabilities.platform).toBe(process.platform)
  })

  test("reports capability names without leaking environment values", () => {
    const capabilities = detectAgentCapabilities({ PATH: "" })
    const summary = capabilitySummary(capabilities)

    expect(summary.every((item) => !item.includes("/"))).toBe(true)
    expect(summary).not.toContain("API key")
  })
})
