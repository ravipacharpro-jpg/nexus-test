export * from "./client.js"
export * from "./server.js"

import { createNexusClient } from "./client.js"
import { createNexusServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export * as data from "./data.js"

export async function createNexus(options?: ServerOptions) {
  const server = await createNexusServer({
    ...options,
  })

  const client = createNexusClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
