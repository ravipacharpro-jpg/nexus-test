import { describe, expect, test } from "bun:test"
import { sessionRouteStatus } from "./session-route-status"

describe("sessionRouteStatus", () => {
  test("distinguishes Auto from manual selection without changing selection precedence", () => {
    expect(sessionRouteStatus({ auto: true })).toMatchObject({ modeLabel: "Auto" })
    expect(sessionRouteStatus({ auto: false })).toMatchObject({ modeLabel: "Manual" })
    expect(sessionRouteStatus({ auto: false }).tooltip).toContain("selected model keeps precedence")
  })

  test("preserves factual local availability evidence and rejects quota or balance claims", () => {
    const status = sessionRouteStatus({
      auto: true,
      availability: {
        label: "Paused after observed rate limit",
        detail: "NEXUS observed a provider rate limit; this is not a remaining-token or balance reading.",
      },
    })

    expect(status.availability?.label).toBe("Paused after observed rate limit")
    expect(status.tooltip).toContain("local configuration or observed status only")
    expect(status.tooltip).toContain("not account balance, remaining tokens, live quota")
    expect(status.tooltip).not.toContain("will switch")
  })
})
