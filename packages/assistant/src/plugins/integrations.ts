import path from "path"
import os from "os"
import { dim, Icon, Style } from "../core/style"
import { getSecret, setSecret, deleteSecret } from "../core/secret-store"
import type { NexusPlugin, PluginContext } from "../core/types"

interface IntegrationSpec {
  id: string
  name: string
  authUrl: string
  tokenUrl?: string
  scope: string
  clientIdEnv: string
  docs: string
  /** Only providers with a fully implemented flow are connectable. */
  implemented: boolean
}

const INTEGRATIONS: IntegrationSpec[] = [
  {
    id: "github",
    name: "GitHub",
    authUrl: "https://github.com/login/device/code",
    scope: "repo read:org",
    clientIdEnv: "NEXUS_GITHUB_CLIENT_ID",
    docs: "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow",
    implemented: true,
  },
  {
    id: "google",
    name: "Google (Gmail/Sheets/Drive)",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/gmail.readonly",
    clientIdEnv: "NEXUS_GOOGLE_CLIENT_ID",
    docs: "https://developers.google.com/identity/protocols/oauth2",
    implemented: false,
  },
  {
    id: "openai",
    name: "OpenAI",
    authUrl: "https://auth.openai.com/authorize",
    scope: "openid profile",
    clientIdEnv: "NEXUS_OPENAI_CLIENT_ID",
    docs: "https://platform.openai.com/docs",
    implemented: false,
  },
  {
    id: "stripe",
    name: "Stripe (read-only)",
    authUrl: "https://connect.stripe.com/oauth/authorize",
    scope: "read_only",
    clientIdEnv: "NEXUS_STRIPE_CLIENT_ID",
    docs: "https://stripe.com/docs/connect/oauth-reference",
    implemented: false,
  },
]

function storePath(): string {
  return path.join(os.homedir(), ".nexus", "integrations.json")
}

function tokenSecret(id: string): string {
  return `integration.${id.replace(/[^a-z0-9._-]+/gi, "-")}.token`
}

async function loadStore(): Promise<Record<string, { connectedAt: number; mode: string }>> {
  const file = Bun.file(storePath())
  if (!(await file.exists())) return {}
  return await file.json()
}

async function connect(ctx: PluginContext): Promise<number | void> {
  const id = ctx.args[0]
  const spec = INTEGRATIONS.find((i) => i.id === id)

  if (!spec) {
    ctx.err(`Unknown integration '${id ?? ""}'. Available:`)
    for (const integration of INTEGRATIONS) ctx.out(`  ${integration.id.padEnd(10)} ${integration.name}`)
    return 1
  }

  const clientId = process.env[spec.clientIdEnv]
  if (!clientId) {
    ctx.err(`${Icon.lock} OAuth client ID missing`)
    ctx.out(`Set ${Style.TEXT_HIGHLIGHT}${spec.clientIdEnv}${Style.TEXT_NORMAL} to your registered OAuth app's client_id.`)
    ctx.out(dim(`Register your own OAuth app (never share secrets) — see ${spec.docs}`))
    return 1
  }

  if (!spec.implemented) {
    ctx.err(`${spec.name} OAuth flow is not implemented yet — listed for transparency only.`)
    ctx.out(dim(`Track progress on https://github.com/itzgeniusboy/nexus/issues`))
    return 1
  }

  ctx.out(`${Icon.lock} Connecting to ${spec.name} via official OAuth device flow...`)

  if (id === "github") {
    const deviceResponse = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: clientId, scope: spec.scope }),
    }).catch(() => undefined)

    if (!deviceResponse) {
      ctx.err("Could not reach GitHub")
      return 1
    }
    const device = (await deviceResponse.json()) as { verification_uri?: string; user_code?: string; device_code?: string }

    if (!device.verification_uri || !device.user_code || !device.device_code) {
      ctx.err("Device flow init failed")
      return 1
    }

    ctx.out("")
    ctx.out(`  Open ${Style.TEXT_HIGHLIGHT_BOLD}${device.verification_uri}${Style.TEXT_NORMAL} and enter code:`)
    ctx.out(`  ${Style.TEXT_SUCCESS_BOLD}${device.user_code}${Style.TEXT_NORMAL}`)
    ctx.out("")

    for (let attempt = 0; attempt < 24; attempt++) {
      await Bun.sleep(5000)
      const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          device_code: device.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      })
      const token = (await tokenResponse.json()) as { access_token?: string; error?: string }

      if (token.access_token) {
        setSecret(tokenSecret(spec.id), token.access_token)
        const store = await loadStore()
        store[spec.id] = { connectedAt: Date.now(), mode: "oauth-device" }
        await Bun.write(storePath(), JSON.stringify(store, null, 2))
        ctx.out(`${Icon.success} ${spec.name} connected — token encrypted at rest`)
        return 0
      }
      if (token.error === "authorization_pending") continue
      if (token.error === "slow_down") {
        await Bun.sleep(5000)
        continue
      }
      ctx.err(`OAuth failed: ${token.error}`)
      return 1
    }
    ctx.err("Timed out waiting for authorization")
    return 1
  }

  ctx.err(`${spec.name} device flow not implemented yet`)
  return 1
}

async function listIntegrations(ctx: PluginContext): Promise<number | void> {
  const store = await loadStore()
  ctx.out(`${Icon.info} Integrations:`)
  for (const spec of INTEGRATIONS) {
    const entry = store[spec.id]
    const status = entry
      ? `${Icon.success} ${dim(new Date(entry.connectedAt).toLocaleString())}`
      : spec.implemented
        ? dim("not connected")
        : dim("coming soon")
    ctx.out(`  ${spec.id.padEnd(10)} ${status}`)
  }
}

async function disconnect(ctx: PluginContext): Promise<number | void> {
  const id = ctx.args[0]
  const spec = INTEGRATIONS.find((i) => i.id === id)
  if (!spec) {
    ctx.err("Unknown integration")
    return 1
  }
  const store = await loadStore()
  delete store[spec.id]
  await Bun.write(storePath(), JSON.stringify(store, null, 2))
  deleteSecret(tokenSecret(spec.id))
  const tokenFile = path.join(os.homedir(), ".nexus", `integration-${spec.id}.token`)
  if (await Bun.file(tokenFile).exists()) {
    await import("fs/promises").then((fs) => fs.unlink(tokenFile))
  }
  ctx.out(`${Icon.success} ${spec.name} disconnected, local token removed`)
}

const plugin: NexusPlugin = {
  name: "integrations",
  version: "0.1.0",
  description: "OAuth connections to third-party services (GitHub device flow implemented)",
  tags: ["oauth", "github", "google", "stripe"],
  commands: [
    { name: "connect", describe: "connect a service via official OAuth, e.g. nexus integrations connect github", usage: "nexus integrations connect <service>", run: connect },
    { name: "list", describe: "list integrations and connection status", usage: "nexus integrations list", run: listIntegrations },
    { name: "disconnect", describe: "revoke locally stored token for a service", usage: "nexus integrations disconnect <service>", run: disconnect },
  ],
}

export default plugin

export * as IntegrationsPlugin from "./integrations"
