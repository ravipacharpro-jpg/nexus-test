import { describe, expect, test } from "bun:test"
import { errorData, errorFormat, errorMessage, humanizeError } from "../../src/util/error"

describe("util.error", () => {
  test("formats native Error instances", () => {
    const err = new Error("boom")
    expect(errorMessage(err)).toBe("boom")
    expect(errorFormat(err)).toContain("boom")

    const data = errorData(err)
    expect(data.type).toBe("Error")
    expect(data.message).toBe("boom")
    expect(String(data.formatted)).toContain("boom")
  })

  test("extracts message from record-like values", () => {
    const err = { message: "bad input", code: "E_BAD" }
    expect(errorMessage(err)).toBe("bad input")

    const data = errorData(err)
    expect(data.message).toBe("bad input")
    expect(data.code).toBe("E_BAD")
  })

  test("never returns bare {} for opaque object errors", () => {
    expect(errorFormat({})).not.toBe("{}")
    expect(errorFormat({})).toContain("no message")

    class OpaqueError {}
    const opaque = new OpaqueError()
    Object.defineProperty(opaque, "secret", { value: "hidden", enumerable: false })
    expect(errorFormat(opaque)).not.toBe("{}")
    expect(errorFormat(opaque)).toContain("OpaqueError")
  })

  test("handles opaque throwables with custom toString", () => {
    const err = {
      toString() {
        return "ResolveMessage: Cannot resolve module"
      },
    }

    expect(errorMessage(err)).toBe("ResolveMessage: Cannot resolve module")

    const data = errorData(err)
    expect(data.message).toBe("ResolveMessage: Cannot resolve module")
    expect(String(data.formatted)).toContain("ResolveMessage")
  })
})

describe("util.error humanizeError", () => {
  test("translates 401 into an API-key hint", () => {
    expect(humanizeError(new Error("401 Unauthorized: invalid api key"))).toContain("API key was rejected")
  })
  test("translates 429 into a rate-limit hint", () => {
    expect(humanizeError(new Error("429 Too Many Requests"))).toContain("Rate limit hit")
  })
  test("translates ECONNREFUSED into a local-service hint", () => {
    expect(humanizeError(new Error("connect ECONNREFUSED 127.0.0.1:20128"))).toContain("local service")
  })
  test("translates fetch failures into a network hint", () => {
    expect(humanizeError(new Error("fetch failed: getaddrinfo ENOTFOUND"))).toContain("internet")
  })
  test("translates timeout into a slow-provider hint", () => {
    expect(humanizeError(new Error("Request aborted: timeout"))).toContain("too long")
  })
  test("translates context-length into a too-long hint", () => {
    expect(humanizeError(new Error("context length exceeded (8192 tokens)"))).toContain("too long")
  })
  test("translates model-not-found into a Ctrl+P hint", () => {
    expect(humanizeError(new Error("model not found: foo/bar"))).toContain("Top 3 Best")
  })
  test("falls back to the original message for unknown errors", () => {
    expect(humanizeError(new Error("something obscure"))).toBe("something obscure")
  })
  test("handles non-Error input gracefully", () => {
    expect(humanizeError("just a string")).toBe("just a string")
    expect(humanizeError(null)).toContain("Something went wrong")
  })
})
