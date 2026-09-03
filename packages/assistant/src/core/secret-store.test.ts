import { describe, expect, test } from "bun:test"
import { setSecret, getSecret, deleteSecret } from "./secret-store"

const NAME = `test.secret.${Date.now()}`

describe("secret-store", () => {
  test("roundtrips a secret encrypted at rest", async () => {
    const value = "cpanel-super-secret-token-123"
    setSecret(NAME, value)
    expect(getSecret(NAME)).toBe(value)

    const raw = await Bun.file(`${process.env.HOME}/.nexus/secrets/${NAME}.enc`).text()
    expect(raw).not.toContain(value)
  })

  test("returns undefined after delete", () => {
    setSecret(NAME, "temp")
    deleteSecret(NAME)
    expect(getSecret(NAME)).toBeUndefined()
  })

  test("tampered ciphertext is rejected", async () => {
    setSecret(NAME, "another-secret")
    const file = `${process.env.HOME}/.nexus/secrets/${NAME}.enc`
    const payload = JSON.parse(await Bun.file(file).text()) as { data: string }
    payload.data = Buffer.from("corrupted").toString("base64")
    await Bun.write(file, JSON.stringify(payload))
    expect(getSecret(NAME)).toBeUndefined()
    deleteSecret(NAME)
  })
})
