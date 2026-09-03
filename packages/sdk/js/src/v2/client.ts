export * from "./gen/types.gen.js"
export type { FileSystemEntry as LocationFileSystemEntry } from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { NexusClient } from "./gen/sdk.gen.js"
import { wrapClientError } from "../error-interceptor.js"
export { type Config as NexusClientConfig, NexusClient }

export type ProviderVaultKey = {
  index: number
  label: string
  key: string
  status: "active" | "rate_limited" | "invalid" | "suspended" | "unknown"
  failures: number
  added: string
  lastChecked?: string
  suspendedUntil?: string
  todayRequests: number
  todayInputTokens: number
  todayOutputTokens: number
}

export type ProviderVaultKeys = {
  providers: Array<{ provider: string; keys: Array<ProviderVaultKey> }>
  autoRotate: boolean
}

export type ProviderActiveModels = {
  models: Array<{
    provider: string
    model: string
    status: ProviderVaultKey["status"]
    logicalModels: string[]
  }>
  checkedAt: string
}

export type ProviderVaultClient = {
  keys: {
    list: () => Promise<ProviderVaultKeys>
    add: (input: { provider: string; key: string; label?: string }) => Promise<ProviderVaultKey>
    remove: (input: { providerID: string; index: number }) => Promise<ProviderVaultKey>
  }
  models: {
    active: () => Promise<ProviderActiveModels>
  }
}

function pick(value: string | null, fallback?: string, encode?: (value: string) => string) {
  if (!value) return
  if (!fallback) return value
  if (value === fallback) return fallback
  if (encode && value === encode(fallback)) return fallback
  return value
}

function rewrite(request: Request, values: { directory?: string; workspace?: string }) {
  if (request.method !== "GET" && request.method !== "HEAD") return request

  const url = new URL(request.url)
  let changed = false

  for (const [name, key] of [
    ["x-nexus-directory", "directory"],
    ["x-nexus-workspace", "workspace"],
  ] as const) {
    const value = pick(
      request.headers.get(name),
      key === "directory" ? values.directory : values.workspace,
      key === "directory" ? encodeURIComponent : undefined,
    )
    if (!value) continue
    for (const query of url.pathname.startsWith("/api/") ? [key, `location[${key}]`] : [key]) {
      if (!url.searchParams.has(query)) {
        url.searchParams.set(query, value)
      }
    }
    changed = true
  }

  if (!changed) return request

  const next = new Request(url, request)
  next.headers.delete("x-nexus-directory")
  next.headers.delete("x-nexus-workspace")
  return next
}

export function createNexusClient(config?: Config & { directory?: string; experimental_workspaceID?: string }) {
  if (!config?.fetch) {
    const customFetch: any = (req: any) => {
      // @ts-ignore
      req.timeout = false
      return fetch(req)
    }
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-nexus-directory": encodeURIComponent(config.directory),
    }
  }

  if (config?.experimental_workspaceID) {
    config.headers = {
      ...config.headers,
      "x-nexus-workspace": config.experimental_workspaceID,
    }
  }

  const client = createClient(config)
  client.interceptors.request.use((request) =>
    rewrite(request, {
      directory: config?.directory,
      workspace: config?.experimental_workspaceID,
    }),
  )
  client.interceptors.response.use((response) => {
    const contentType = response.headers.get("content-type")
    if (contentType === "text/html")
      throw new Error("Request is not supported by this version of NEXUS Server (Server responded with text/html)")

    return response
  })
  client.interceptors.error.use(wrapClientError)
  const nexus = new NexusClient({ client })
  const request = <T>(options: Parameters<typeof client.request>[0]) =>
    client.request({ ...options, responseStyle: "data", throwOnError: true }) as Promise<T>
  const providerVault: ProviderVaultClient = {
    keys: {
      list: () => request<ProviderVaultKeys>({ method: "GET", url: "/provider/keys" }),
      add: (input) => request<ProviderVaultKey>({ method: "POST", url: "/provider/keys", body: input }),
      remove: ({ providerID, index }) =>
        request<ProviderVaultKey>({
          method: "DELETE",
          url: "/provider/keys/{providerID}/{index}",
          path: { providerID, index },
        }),
    },
    models: {
      active: () => request<ProviderActiveModels>({ method: "GET", url: "/provider/models/active" }),
    },
  }
  return Object.assign(nexus, { providerVault })
}
