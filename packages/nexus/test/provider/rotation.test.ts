import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  addApiKey,
  apiVaultPublicRows,
  ensureApiKey,
  removeManagedApiKey,
  getCachedKeyStatus,
  loadApiVault,
  resetApiVaultForTests,
  saveApiVault,
  updateApiKeyStatus,
} from "@/api/ApiVault"
import {
  isTextGenerationCandidate,
  modelForProvider,
  preferredModelForProvider,
  RotationEngine,
} from "@/provider/rotation"
import { MODEL_MAP } from "@/api/ModelRouter"

let isolatedHome = ""
const originalHome = process.env.HOME

beforeEach(() => {
  isolatedHome = mkdtempSync(join(tmpdir(), "nexus-rotation-test-"))
  process.env.HOME = isolatedHome
  resetApiVaultForTests()
})

afterEach(() => {
  resetApiVaultForTests()
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  rmSync(isolatedHome, { recursive: true, force: true })
})

describe("provider key UI data", () => {
  test("migrates Auth keys idempotently and returns only masked rows", () => {
    const raw = "sk-or-v1-0123456789abcdef"
    const first = ensureApiKey("openrouter", raw)
    const second = ensureApiKey("openrouter", raw)
    const rows = apiVaultPublicRows()

    expect(first?.status).toBe("unknown")
    expect(second?.key).toBe(raw)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.keys[0]?.key).not.toBe(raw)
    expect(JSON.stringify(rows)).not.toContain(raw)
  })

  test("removes managed UI keys without deleting CLI keys", () => {
    addApiKey("openrouter", "cli-key", "cli", "cli")
    addApiKey("openrouter", "ui-key", "ui", "ui")

    expect(removeManagedApiKey("openrouter", "ui-key")).toBe(true)
    expect(removeManagedApiKey("openrouter", "cli-key")).toBe(false)
    expect(loadApiVault().providers.openrouter.map((entry) => entry.key)).toEqual(["cli-key"])
  })
})

describe("provider model selection", () => {
  test("does not select a Gemini TTS model from a partial catalog", () => {
    const models = {
      "gemini-3.1-flash-tts-preview": {
        modalities: { input: ["text"], output: ["audio"] },
      },
      "gemini-2.5-flash": {
        modalities: { input: ["text"], output: ["text"] },
      },
    }

    expect(preferredModelForProvider("google", models)).toBe("gemini-2.5-flash")
    expect(modelForProvider("google", models)).toBe("gemini-2.5-flash")
    expect(
      isTextGenerationCandidate("google", "gemini-3.1-flash-tts-preview", models["gemini-3.1-flash-tts-preview"]),
    ).toBe(false)
  })

  test("returns no model when a provider has only non-text models", () => {
    const models = {
      "gemini-3.1-flash-tts-preview": {
        modalities: { input: ["text"], output: ["audio"] },
      },
      "gemini-3.1-flash-image-preview": {
        modalities: { input: ["text"], output: ["image"] },
      },
    }

    expect(modelForProvider("google", models)).toBeUndefined()
  })

  test("keeps a compatible Groq model when the preferred catalog entry is absent", () => {
    const models = {
      "whisper-large-v3": { modalities: { input: ["audio"], output: ["text"] } },
      "llama-3.1-8b-instant": { modalities: { input: ["text"], output: ["text"] } },
    }

    expect(modelForProvider("groq", models)).toBe("llama-3.1-8b-instant")
  })
})

describe("offline provider catalog fallback", () => {
  test("creates a complete text-only catalog independent of configured providers", async () => {
    const { withLocalFallbackCatalog } = await import("@/provider/provider")
    const catalog = withLocalFallbackCatalog({}, { groq: ["test-key"] })

    expect(Object.keys(catalog)).toContain("groq")
    expect(Object.keys(catalog)).toContain("openai")
    expect(Object.keys(catalog)).toContain("anthropic")
    expect(catalog.groq.models["openai/gpt-oss-120b"].modalities).toEqual({ input: ["text"], output: ["text"] })
    expect(catalog.groq.models["llama-3.1-8b-instant"]).toBeUndefined()
  })
})

describe("preferred defaults", () => {
  test("does not retain known stale Groq or Gemini defaults", async () => {
    const { PREFERRED_MODELS } = await import("@/provider/rotation")

    expect(PREFERRED_MODELS.groq).toContain("openai/gpt-oss-120b")
    expect(PREFERRED_MODELS.groq).not.toContain("llama-3.1-8b-instant")
    expect(PREFERRED_MODELS.google).toContain("gemini-2.5-flash")
    expect(PREFERRED_MODELS.google).not.toContain("gemini-3.1-flash-tts-preview")
  })
})

describe("legacy model aliases", () => {
  test("resolve to current text-chat defaults", () => {
    expect(MODEL_MAP.llama3_1.providerModels.groq).toBe("openai/gpt-oss-120b")
    expect(MODEL_MAP.gemini.providerModels.gemini).toBe("gemini-2.5-flash")
    expect(MODEL_MAP.gemini.providerModels.openrouter).toBe("google/gemini-2.5-flash")
  })
})

describe("setup validation model candidates", () => {
  test("accepts chat-capable catalog IDs and rejects non-chat families", async () => {
    const { isChatModelID } = await import("@/cli/cmd/setup")

    expect(isChatModelID("whisper-large-v3", "groq")).toBe(false)
    expect(isChatModelID("llama-3.3-70b-versatile", "groq")).toBe(true)
    expect(isChatModelID("gemini-3.1-flash-tts-preview", "google")).toBe(false)
    expect(isChatModelID("gemini-3.1-flash-preview", "google")).toBe(true)
    expect(isChatModelID("meta-llama/llama-3.1-8b-instruct:free", "openrouter")).toBe(true)
  })
})

describe("vault-aware key rotation", () => {
  test("skips a rate-limited key while another healthy key exists, then allows it as the last key", () => {
    addApiKey("groq", "key-one")
    addApiKey("groq", "key-two")
    updateApiKeyStatus("groq", "key-one", "rate_limited")

    const rotation = new RotationEngine({ groq: ["key-one", "key-two"] })
    expect(rotation.next("groq")).toBe("key-two")

    updateApiKeyStatus("groq", "key-two", "rate_limited")
    expect(rotation.next("groq")).toBeUndefined()

    const vault = loadApiVault()
    for (const entry of vault.providers.groq) {
      entry.cooldownUntil = new Date(Date.now() - 1000).toISOString()
    }
    saveApiVault(vault)
    expect(rotation.next("groq")).toBe("key-one")
  })

  test("always skips invalid keys", () => {
    addApiKey("groq", "key-invalid")
    addApiKey("groq", "key-healthy")
    updateApiKeyStatus("groq", "key-invalid", "invalid")

    const rotation = new RotationEngine({ groq: ["key-invalid", "key-healthy"] })
    expect(rotation.next("groq")).toBe("key-healthy")
  })

  test("skips invalid config-only keys and resets them after success", () => {
    updateApiKeyStatus("groq", "config-only-key", "invalid")
    const rotation = new RotationEngine({ groq: ["config-only-key"] })
    expect(rotation.next("groq")).toBeUndefined()
    expect(getCachedKeyStatus("config-only-key")?.status).toBe("invalid")

    updateApiKeyStatus("groq", "config-only-key", "active")
    expect(getCachedKeyStatus("config-only-key")?.status).toBe("active")
    expect(getCachedKeyStatus("config-only-key")?.failures).toBe(0)
    expect(rotation.next("groq")).toBe("config-only-key")
  })

  test("returns a suspended key after its suspension expires", () => {
    addApiKey("groq", "key-suspended")
    const data = loadApiVault()
    data.providers.groq[0].status = "suspended"
    data.providers.groq[0].suspendedUntil = new Date(Date.now() - 1000).toISOString()
    saveApiVault(data)

    const rotation = new RotationEngine({ groq: ["key-suspended"] })
    expect(rotation.next("groq")).toBe("key-suspended")
  })
})
