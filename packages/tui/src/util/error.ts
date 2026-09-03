import { isRecord } from "./record"

type ConfigIssue = { message: string; path: string[] }

export function cliErrorMessage(input: unknown): string | undefined {
  if (input instanceof Error && isRecord(input.cause) && "body" in input.cause) {
    const formatted = cliErrorMessage(input.cause.body)
    if (formatted) return formatted
  }

  if (tagged(input, "CliError")) {
    if (typeof input.exitCode === "number") process.exitCode = input.exitCode
    return field(input, "message") ?? ""
  }
  if (tagged(input, "AccountServiceError") || tagged(input, "AccountTransportError")) {
    return field(input, "message") ?? ""
  }

  const model = configData(input, "ProviderModelNotFoundError")
  if (model) {
    const suggestions = Array.isArray(model.suggestions)
      ? model.suggestions.filter((item): item is string => typeof item === "string")
      : []
    return [
      `Model not found: ${field(model, "providerID")}/${field(model, "modelID")}`,
      ...(suggestions.length ? ["Did you mean: " + suggestions.join(", ")] : []),
      "Try: `nexus models` to list available models",
      "Or check your config (nexus.json) provider/model names",
    ].join("\n")
  }

  const provider = configData(input, "ProviderInitError")
  if (provider)
    return `Failed to initialize provider "${field(provider, "providerID")}". Check credentials and configuration.`

  const json = configData(input, "ConfigJsonError")
  if (json) {
    const message = field(json, "message")
    return `Config file at ${field(json, "path")} is not valid JSON(C)` + (message ? `: ${message}` : "")
  }

  const directory = configData(input, "ConfigDirectoryTypoError")
  if (directory) {
    return `Directory "${field(directory, "dir")}" in ${field(directory, "path")} is not valid. Rename the directory to "${field(directory, "suggestion")}" or remove it. This is a common typo.`
  }

  const frontmatter = configData(input, "ConfigFrontmatterError")
  if (frontmatter) return field(frontmatter, "message") ?? ""

  const invalid = configData(input, "ConfigInvalidError")
  if (invalid) {
    const path = field(invalid, "path")
    const message = field(invalid, "message")
    const issues = Array.isArray(invalid.issues)
      ? invalid.issues.filter((issue): issue is ConfigIssue => {
          return (
            isRecord(issue) &&
            typeof issue.message === "string" &&
            Array.isArray(issue.path) &&
            issue.path.every((item) => typeof item === "string")
          )
        })
      : []
    return [
      `Configuration is invalid${path && path !== "config" ? ` at ${path}` : ""}` + (message ? `: ${message}` : ""),
      ...issues.map((issue) => "↳ " + issue.message + " " + issue.path.join(".")),
    ].join("\n")
  }

  if (tagged(input, "UICancelledError") || named(input, "UICancelledError")) return ""
  if (isRecord(input) && named(input, "MCPFailed")) {
    const name = isRecord(input.data) ? field(input.data, "name") : undefined
    return `MCP server "${name}" failed. Note, NEXUS does not support MCP authentication yet.`
  }
  return undefined
}

/**
 * humanizeError — turn raw, low-level errors into something a user can act
 * on without digging through a stack trace. Designed to be called from
 * the toast layer and the error-component crash screen.
 *
 * Each branch maps a common error class to a one-line explanation plus a
 * concrete next step the user can take. Falls back to cliErrorMessage and
 * then to errorMessage so a non-matched error still gets a sane string.
 */
export function humanizeError(input: unknown): string {
  if (input == null) return "Something went wrong, but no error was returned."
  const raw = (() => {
    if (input instanceof Error) return input.message
    if (isRecord(input) && typeof input.message === "string" && input.message) return input.message
    return errorMessage(input)
  })()
  const lower = raw.toLowerCase()

  // Network / connectivity
  if (/econnrefused|enotfound|network|fetch failed|getaddrinfo|timeout|timed?\s*out|aborted/i.test(lower)) {
    if (/refused/i.test(lower)) {
      return `Can't reach the local service. Is it running? (Check: omniroute on :20128, or your local LLM server.)`
    }
    if (/enotfound|getaddrinfo|network/i.test(lower)) {
      return `No internet connection detected. NEXUS needs network access to call LLM providers.`
    }
    if (/timeout|timed?\s*out|aborted/i.test(lower)) {
      return `The request took too long and was cancelled. The provider may be slow or rate-limiting you. Try again in a few seconds, or switch model via Ctrl+P.`
    }
  }

  // Auth / API key problems
  if (/401|unauthorized|invalid.*api.*key|api.*key.*invalid|authentication/i.test(lower)) {
    return `API key was rejected. Open Ctrl+P → Provider to add or fix the key, or run: nexus auth login.`
  }
  if (/402|payment required|quota|insufficient.*credit|billing/i.test(lower)) {
    return `Your account is out of credit. Top it up at the provider's dashboard, then retry.`
  }
  if (/403|forbidden|not allowed/i.test(lower)) {
    return `Access denied. The provider blocked this model or endpoint for your key. Try a different model with Ctrl+P.`
  }
  if (/429|rate.?limit|too many requests/i.test(lower)) {
    return `Rate limit hit. Wait a few seconds and try again, or switch to a different provider with Ctrl+P.`
  }

  // Model issues
  if (/model.*not.*found|unknown model|invalid model/i.test(lower)) {
    return `That model name isn't recognized. Press Ctrl+P → Top 3 Best to see currently available models.`
  }
  if (/context.*length|too.*long|exceeded.*token|maximum.*context/i.test(lower)) {
    return `The conversation is too long for this model's context window. Start a new session or pick a larger-context model with Ctrl+P.`
  }

  // Browser / playwright issues (autofarm)
  if (/playwright|browser.*not.*installed|chromium|chrome/i.test(lower)) {
    return `Browser automation is not available on this device. For fully autonomous API farming, run NEXUS on a desktop with Chrome installed.`
  }

  // Fall back to existing layers
  return cliErrorMessage(input) ?? raw
}

function tagged(input: unknown, tag: string): input is Record<string, unknown> {
  return isRecord(input) && input._tag === tag
}

function named(input: unknown, name: string) {
  return isRecord(input) && (input.name === name || input._tag === name)
}

function configData(input: unknown, tag: string) {
  if (!isRecord(input)) return undefined
  if (input.name === tag && isRecord(input.data)) return input.data
  if (input._tag === tag) return input
  return undefined
}

function field(input: Record<string, unknown>, key: string) {
  return typeof input[key] === "string" ? input[key] : undefined
}

export function errorFormat(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`
  }

  if (typeof error === "object" && error !== null) {
    try {
      const json = JSON.stringify(error, null, 2)
      // Plain objects whose own properties are all non-enumerable (or empty)
      // serialize to "{}", which prints as a useless bare `{}` on stderr.
      // Fall back to a custom toString first, then to ctor name + own prop names.
      if (json === "{}") {
        const str = String(error)
        if (str && str !== "[object Object]") return str
        const ctor = error.constructor?.name
        const prefix = ctor && ctor !== "Object" ? ctor : "Error"
        const names = Object.getOwnPropertyNames(error)
        return names.length === 0 ? `${prefix} (no message)` : `${prefix} { ${names.join(", ")} }`
      }
      return json
    } catch {
      return "Unexpected error (unserializable)"
    }
  }

  return String(error)
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message) return error.message
    if (error.name) return error.name
  }

  if (isRecord(error) && typeof error.message === "string" && error.message) {
    return error.message
  }

  if (isRecord(error) && isRecord(error.data) && typeof error.data.message === "string" && error.data.message) {
    return error.data.message
  }

  const text = String(error)
  if (text && text !== "[object Object]") return text

  const formatted = errorFormat(error)
  if (formatted) return formatted
  return "unknown error"
}

export function errorData(error: unknown) {
  if (error instanceof Error) {
    return {
      type: error.name,
      message: errorMessage(error),
      stack: error.stack,
      cause: error.cause === undefined ? undefined : errorFormat(error.cause),
      formatted: errorFormat(error),
    }
  }

  if (!isRecord(error)) {
    return {
      type: typeof error,
      message: errorMessage(error),
      formatted: errorFormat(error),
    }
  }

  const data = Object.getOwnPropertyNames(error).reduce<Record<string, unknown>>((acc, key) => {
    const value = error[key]
    if (value === undefined) return acc
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      acc[key] = value
      return acc
    }
    // oxlint-disable-next-line no-base-to-string -- intentional coercion of arbitrary error properties
    acc[key] = value instanceof Error ? value.message : String(value)
    return acc
  }, {})

  if (typeof data.message !== "string") data.message = errorMessage(error)
  if (typeof data.type !== "string") data.type = error.constructor?.name
  data.formatted = errorFormat(error)
  return data
}
