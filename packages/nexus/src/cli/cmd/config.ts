import fs from "node:fs"
import path from "node:path"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { normalizeProviderKeyName, redactSecret, PREFERRED_MODELS } from "@/provider/rotation"

type ConfigRecord = Record<string, any>

function homeDirectory(): string {
  return process.env.HOME || process.env.USERPROFILE || process.cwd()
}

function configCandidates(): string[] {
  const home = homeDirectory()
  return [path.join(home, ".config", "nexus", "nexus.jsonc"), path.join(home, ".nexus", "config.json")]
}

function resolveConfigPath(): string {
  return configCandidates().find((candidate) => fs.existsSync(candidate)) ?? configCandidates()[0]
}

/** Strip JSONC comments without touching URLs or comment-like text inside strings. */
function stripJsoncComments(source: string): string {
  let output = ""
  let inString = false
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let index = 0; index < source.length; index++) {
    const current = source[index]
    const next = source[index + 1]

    if (lineComment) {
      if (current === "\n") {
        lineComment = false
        output += current
      } else {
        output += " "
      }
      continue
    }

    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false
        output += "  "
        index++
      } else {
        output += current === "\n" ? "\n" : " "
      }
      continue
    }

    if (inString) {
      output += current
      if (escaped) escaped = false
      else if (current === "\\") escaped = true
      else if (current === '"') inString = false
      continue
    }

    if (current === '"') {
      inString = true
      output += current
    } else if (current === "/" && next === "/") {
      lineComment = true
      output += "  "
      index++
    } else if (current === "/" && next === "*") {
      blockComment = true
      output += "  "
      index++
    } else {
      output += current
    }
  }

  return output.replace(/,\s*([}\]])/g, "$1")
}

export function readNexusConfig(): { path: string; data: ConfigRecord } {
  const configPath = resolveConfigPath()
  if (!fs.existsSync(configPath)) return { path: configPath, data: {} }

  const source = fs.readFileSync(configPath, "utf8").trim()
  if (!source) return { path: configPath, data: {} }

  const parsed = JSON.parse(stripJsoncComments(source))
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Configuration file must contain a JSON object: ${configPath}`)
  }
  return { path: configPath, data: parsed as ConfigRecord }
}

export function writeNexusConfig(configPath: string, data: ConfigRecord): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  try {
    fs.chmodSync(configPath, 0o600)
  } catch {
    // Some Termux filesystems do not support chmod; the write itself is valid.
  }
}

function parseAssignment(input: unknown): { key: string; value: string } | undefined {
  if (typeof input !== "string") return undefined
  const separator = input.indexOf("=")
  if (separator <= 0) return undefined
  const key = input.slice(0, separator).trim()
  const value = input.slice(separator + 1).trim()
  if (!key || !value) return undefined
  return { key, value }
}

function providerModels(providerID: keyof typeof PREFERRED_MODELS): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    PREFERRED_MODELS[providerID].map((id) => [
      id,
      {
        id,
        name: id,
        reasoning: false,
        tool_call: true,
        modalities: { input: ["text"], output: ["text"] },
      },
    ]),
  )
}

function providerDefinition(providerID: string): Record<string, unknown> | undefined {
  const definitions: Record<string, Record<string, unknown>> = {
    groq: {
      name: "Groq",
      api: "https://api.groq.com/openai/v1",
      npm: "@ai-sdk/groq",
      models: providerModels("groq"),
    },
    openrouter: {
      name: "OpenRouter",
      api: "https://openrouter.ai/api/v1",
      npm: "@openrouter/ai-sdk-provider",
      models: providerModels("openrouter"),
    },
    google: {
      name: "Gemini",
      api: "https://generativelanguage.googleapis.com/v1beta",
      npm: "@ai-sdk/google",
      models: providerModels("google"),
    },
    openai: { name: "OpenAI", api: "https://api.openai.com/v1", npm: "@ai-sdk/openai-compatible" },
  }
  return definitions[providerID]
}

export const ConfigSetCommand = cmd({
  command: "set <key_value>",
  describe: "Store configuration (e.g. GROQ_API_KEY=xxx)",
  builder: (yargs) =>
    yargs.positional("key_value", {
      describe: "Key=Value pair to set",
      type: "string",
    }),
  async handler(args: { key_value?: string }) {
    const assignment = parseAssignment(args.key_value)
    if (!assignment) {
      UI.error("Invalid format. Use KEY=VALUE")
      process.exitCode = 1
      return
    }

    try {
      const { path: configPath, data } = readNexusConfig()
      const providerID = normalizeProviderKeyName(assignment.key)

      if (providerID) {
        const storageProviderID = providerID === "google" ? "gemini" : providerID
        const apiKeys = (data.api_keys && typeof data.api_keys === "object" ? data.api_keys : {}) as Record<string, unknown>
        const existing = Array.isArray(apiKeys[storageProviderID]) ? apiKeys[storageProviderID].filter((item) => typeof item === "string") : []
        apiKeys[storageProviderID] = Array.from(new Set([...existing, assignment.value]))
        data.api_keys = apiKeys
        data.rotation = true

        const definition = providerDefinition(providerID)
        if (definition) {
          data.provider = data.provider && typeof data.provider === "object" ? data.provider : {}
          data.provider[providerID] = { ...(data.provider[providerID] ?? {}), ...definition }
        }
        
        // Remove stale/legacy model reference so the provider's preferred model is chosen
        if (typeof data.model === "string") {
          delete data.model
        }
        
        writeNexusConfig(configPath, data)
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓  " + UI.Style.TEXT_NORMAL + `${providerID} API key configured`)
        return
      }

      data[assignment.key] = assignment.value
      writeNexusConfig(configPath, data)
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓  " + UI.Style.TEXT_NORMAL + `${assignment.key} set`)
    } catch (error) {
      UI.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  },
})

export const ConfigGetCommand = cmd({
  command: "get <key>",
  describe: "Retrieve configuration",
  builder: (yargs) =>
    yargs.positional("key", {
      describe: "Key to get",
      type: "string",
    }),
  async handler(args: { key?: string }) {
    const key = args.key?.trim()
    if (!key) {
      UI.error("Invalid key")
      process.exitCode = 1
      return
    }

    try {
      const { data } = readNexusConfig()
      let value: unknown
      const providerID = normalizeProviderKeyName(key)
      if (providerID) {
        const storageProviderID = providerID === "google" ? "gemini" : providerID
        const values = data.api_keys?.[storageProviderID] ?? data.api_keys?.[providerID]
        value = Array.isArray(values) ? values.map((item) => redactSecret(String(item))).join(", ") : undefined
      } else {
        value = data[key]
      }

      if (value === undefined || value === "") {
        UI.println(UI.Style.TEXT_WARNING_BOLD + "!  " + UI.Style.TEXT_NORMAL + `${key} is not set`)
      } else {
        UI.println(String(value))
      }
    } catch (error) {
      UI.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  },
})

export const ConfigCommand = cmd({
  command: "config",
  describe: "Manage configuration",
  builder: (yargs) => yargs.command(ConfigSetCommand).command(ConfigGetCommand).demandCommand(),
  async handler() {},
})
