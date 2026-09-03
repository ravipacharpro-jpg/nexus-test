import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["NEXUS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
const fff = process.env["NEXUS_DISABLE_FFF"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("NEXUS_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  NEXUS_AUTO_HEAP_SNAPSHOT: truthy("NEXUS_AUTO_HEAP_SNAPSHOT"),
  NEXUS_GIT_BASH_PATH: process.env["NEXUS_GIT_BASH_PATH"],
  NEXUS_CONFIG: process.env["NEXUS_CONFIG"],
  NEXUS_CONFIG_CONTENT: process.env["NEXUS_CONFIG_CONTENT"],
  NEXUS_DISABLE_AUTOUPDATE: truthy("NEXUS_DISABLE_AUTOUPDATE"),
  NEXUS_ALWAYS_NOTIFY_UPDATE: truthy("NEXUS_ALWAYS_NOTIFY_UPDATE"),
  NEXUS_DISABLE_PRUNE: truthy("NEXUS_DISABLE_PRUNE"),
  NEXUS_DISABLE_TERMINAL_TITLE: truthy("NEXUS_DISABLE_TERMINAL_TITLE"),
  NEXUS_SHOW_TTFD: truthy("NEXUS_SHOW_TTFD"),
  NEXUS_DISABLE_AUTOCOMPACT: truthy("NEXUS_DISABLE_AUTOCOMPACT"),
  NEXUS_DISABLE_MODELS_FETCH: truthy("NEXUS_DISABLE_MODELS_FETCH"),
  NEXUS_DISABLE_MOUSE: truthy("NEXUS_DISABLE_MOUSE"),
  NEXUS_FAKE_VCS: process.env["NEXUS_FAKE_VCS"],
  NEXUS_SERVER_PASSWORD: process.env["NEXUS_SERVER_PASSWORD"],
  NEXUS_SERVER_USERNAME: process.env["NEXUS_SERVER_USERNAME"],
  NEXUS_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("NEXUS_DISABLE_FFF"),

  // Experimental
  NEXUS_EXPERIMENTAL_FILEWATCHER: Config.boolean("NEXUS_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  NEXUS_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("NEXUS_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  NEXUS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("NEXUS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  NEXUS_MODELS_URL: process.env["NEXUS_MODELS_URL"],
  NEXUS_MODELS_PATH: process.env["NEXUS_MODELS_PATH"],
  NEXUS_DB: process.env["NEXUS_DB"],

  NEXUS_WORKSPACE_ID: process.env["NEXUS_WORKSPACE_ID"],
  NEXUS_EXPERIMENTAL_WORKSPACES: enabledByExperimental("NEXUS_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get NEXUS_DISABLE_PROJECT_CONFIG() {
    return truthy("NEXUS_DISABLE_PROJECT_CONFIG")
  },
  get NEXUS_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("NEXUS_EXPERIMENTAL_REFERENCES")
  },
  get NEXUS_TUI_CONFIG() {
    return process.env["NEXUS_TUI_CONFIG"]
  },
  get NEXUS_CONFIG_DIR() {
    return process.env["NEXUS_CONFIG_DIR"]
  },
  get NEXUS_PURE() {
    return truthy("NEXUS_PURE")
  },
  get NEXUS_PERMISSION() {
    return process.env["NEXUS_PERMISSION"]
  },
  get NEXUS_PLUGIN_META_FILE() {
    return process.env["NEXUS_PLUGIN_META_FILE"]
  },
  get NEXUS_CLIENT() {
    return process.env["NEXUS_CLIENT"] ?? "cli"
  },
}
