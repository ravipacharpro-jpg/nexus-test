import { describe, expect, test } from "bun:test"
import { redactSensitive, containsSensitive } from "./redact"

describe("redactSensitive", () => {
  test("redacts OTP-style digit codes", () => {
    const out = redactSensitive("otp mera 482913 hai")
    expect(out).not.toContain("482913")
    expect(out).toContain("[REDACTED-CODE]")
  })

  test("redacts spaced OTP groups", () => {
    const out = redactSensitive("recovery code 482 913")
    expect(out).not.toContain("482 913")
    expect(out).not.toMatch(/\d/)
    expect(out).toMatch(/\[REDACTED/)
  })

  test("redacts common API key shapes", () => {
    for (const key of [
      "sk-ant-api03-abcdefghij1234567890",
      "gsk_AbCdEfGhIjKlMnOpQrStUv",
      "xai-AbCdEfGhIjKlMnOp",
      "ghp_AbCdEfGhIjKlMnOpQrSt1234",
      "AIzaSyAbCdEfGhIjKlMnOpQrSt",
    ]) {
      const out = redactSensitive(`key hai ${key} use karo`)
      expect(out).not.toContain(key)
      expect(containsSensitive(`key hai ${key}`)).toBe(true)
    }
  })

  test("redacts password assignments in any phrasing", () => {
    for (const line of [
      'password is hunter2',
      "password: hunter2",
      "password=hunter2",
      'API_KEY sk-ant-api03-secretvalue',
      'mera token abc123def456 hai',
    ]) {
      const out = redactSensitive(line)
      expect(out).not.toContain("hunter2")
      expect(out).toContain("[REDACTED]")
    }
  })

  test("leaves normal commands untouched", () => {
    const cmd = "website test karo https://example.com"
    expect(redactSensitive(cmd)).toBe(cmd)
    expect(containsSensitive(cmd)).toBe(false)
  })
})
