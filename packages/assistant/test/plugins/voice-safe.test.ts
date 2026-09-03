import { describe, expect, test } from "bun:test"
import { guardVoiceCommand } from "../../src/plugins/voice"

describe("Voice Commander authentication safety", () => {
  test("blocks OTPs, passwords, bearer tokens and provider-like keys before routing", () => {
    for (const input of ["mera otp 123456 hai", "password hunter2", "Bearer abcdefghijklmnop", "sk-abcdefghijklmnop"]) {
      const result = guardVoiceCommand(input)
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.message).not.toContain(input)
        expect(result.message).toContain("not displayed, stored, or routed")
      }
    }
  })

  test("keeps an ordinary voice command routable", () => {
    expect(guardVoiceCommand("project ke tests chalao")).toEqual({ allowed: true, command: "project ke tests chalao" })
  })
})
