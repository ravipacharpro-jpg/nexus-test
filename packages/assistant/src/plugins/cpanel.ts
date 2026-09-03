import path from "path"
import { Style, Icon, dim } from "../core/style"
import { getSecret, setSecret, deleteSecret } from "../core/secret-store"
import type { NexusPlugin, PluginContext } from "../core/types"

const EOL = "\n"

interface UapiResponse {
  errors?: string[]
  status?: number
  data?: unknown
  metadata?: Record<string, unknown>
}

interface CpanelConfig {
  host: string
  user: string
}

function configPath(ctx: PluginContext): string {
  return path.join(process.env.HOME ?? ctx.cwd, ".nexus", "cpanel.json")
}

const TOKEN_SECRET = "cpanel.token"

async function loadToken(ctx: PluginContext): Promise<string | undefined> {
  const stored = getSecret(TOKEN_SECRET)
  if (stored) return stored
  const keyFile = Bun.file(configPath(ctx) + ".key")
  if (!(await keyFile.exists())) return undefined
  const legacy = (await keyFile.text()).trim()
  if (!legacy) return undefined
  setSecret(TOKEN_SECRET, legacy)
  await Bun.write(configPath(ctx) + ".key", "")
  await Bun.$`rm -f ${configPath(ctx) + ".key"}`.quiet().catch(() => {})
  return legacy
}

async function loadConfig(ctx: PluginContext): Promise<CpanelConfig & { token: string } | undefined> {
  const file = Bun.file(configPath(ctx))
  if (!(await file.exists())) return undefined
  const data = (await file.json()) as CpanelConfig
  const token = await loadToken(ctx)
  if (!token) return undefined
  return { ...data, token }
}

async function saveConfig(ctx: PluginContext, config: CpanelConfig & { token?: string }) {
  await Bun.write(configPath(ctx), JSON.stringify({ host: config.host, user: config.user }, null, 2))
  if (config.token) setSecret(TOKEN_SECRET, config.token)
}

async function clearConfig(ctx: PluginContext) {
  deleteSecret(TOKEN_SECRET)
  await Bun.$`rm -f ${configPath(ctx)}`.quiet().catch(() => {})
}

function maskToken(token: string): string {
  if (token.length <= 8) return "****"
  return token.slice(0, 4) + "…" + token.slice(-4)
}

async function uapi(
  ctx: PluginContext,
  module: string,
  fn: string,
  params: Record<string, string> = {},
  configOverride?: CpanelConfig & { token: string },
): Promise<UapiResponse | undefined> {
  const config = configOverride ?? (await loadConfig(ctx))
  if (!config) {
    ctx.err("Not connected — run: nexus cpanel connect --host <host> --user <user>")
    return undefined
  }

  const url = new URL(`https://${config.host}:2083/execute/${module}/${fn}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

  const response = await fetch(url, {
    headers: {
      Authorization: `cpanel ${config.user}:${config.token}`,
    },
  }).catch((error) => {
    ctx.err(`Request failed: ${error}`)
    return undefined
  })

  if (!response) return undefined

  const body = (await response.json().catch(() => undefined)) as UapiResponse | undefined
  if (body?.errors?.length) {
    ctx.err(`UAPI error: ${body.errors.join("; ")}`)
    return undefined
  }
  return body
}

async function readSecretLine(): Promise<string> {
  const stdin = process.stdin
  let raw = false
  try {
    if (typeof (stdin as { setRawMode?: (mode: boolean) => void }).setRawMode === "function") {
      ;(stdin as { setRawMode: (mode: boolean) => void }).setRawMode(true)
      raw = true
    }
  } catch {}
  process.stderr.write("")

  const token = await new Promise<string>((resolve) => {
    let input = ""
    const onData = (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8")
      for (const ch of text) {
        if (ch === "\r" || ch === "\n") {
          cleanup()
          resolve(input)
          return
        }
        if ((ch === "\x7f" || ch === "\b") && input.length > 0) {
          input = input.slice(0, -1)
          continue
        }
        if (ch >= " " && ch !== "\x03") input += ch
        if (ch === "\x03") {
          cleanup()
          process.exit(130)
        }
      }
    }
    const cleanup = () => {
      stdin.pause()
      stdin.removeListener("data", onData)
    }
    stdin.setEncoding("utf8")
    stdin.resume()
    stdin.on("data", onData)
  })

  if (raw) {
    try {
      ;(stdin as { setRawMode: (mode: boolean) => void }).setRawMode(false)
    } catch {}
  }
  process.stderr.write(EOL)
  return token.trim()
}

async function connect(ctx: PluginContext): Promise<number | void> {
  const hostFlag = typeof ctx.flags.host === "string" ? ctx.flags.host : undefined
  const userFlag = typeof ctx.flags.user === "string" ? ctx.flags.user : undefined

  if (!hostFlag || !userFlag) {
    ctx.err("Usage: nexus cpanel connect --host cpanel.example.com --user myuser")
    return 1
  }

  ctx.out(`${Icon.lock} Connect to ${Style.TEXT_HIGHLIGHT_BOLD}${hostFlag}${Style.TEXT_NORMAL}`)
  ctx.out(dim("Create an API token in cPanel: Manage Account → Manage API Tokens"))
  ctx.out(dim("NEXUS NEVER asks for your cPanel password."))
  process.stderr.write(`${Style.TEXT_HIGHLIGHT_BOLD}Paste API token (input hidden): ${Style.TEXT_NORMAL}`)

  const token = await readSecretLine()

  if (!token) {
    ctx.err("No token entered — cancelled")
    return 1
  }

  const candidate = { host: hostFlag, user: userFlag, token }
  ctx.out(dim("Validating token with a read-only call…"))
  const probe = await uapi(ctx, "Mysql", "list_databases", {}, candidate)
  if (!probe) {
    ctx.err("Token validation failed — nothing was saved. Check host/user/token and try again.")
    return 1
  }

  await saveConfig(ctx, candidate)
  ctx.out(`${Icon.success} Connected and verified. Token encrypted at rest (${maskToken(token)}).`)
}

async function disconnect(ctx: PluginContext): Promise<number | void> {
  await clearConfig(ctx)
  ctx.out(`${Icon.success} Disconnected. Stored token removed.`)
}

async function dbCreate(ctx: PluginContext): Promise<number | void> {
  const name = typeof ctx.flags.name === "string" ? ctx.flags.name : ctx.args[0]
  if (!name) {
    ctx.err("Usage: nexus cpanel db:create --name mydb")
    return 1
  }
  const ok = await ctx.confirm({
    title: `Create database '${name}' on ${typeof ctx.flags.host === "string" ? ctx.flags.host : "your cPanel host"}?`,
    detail: "This performs a remote write on your hosting account",
  })
  if (!ok) {
    ctx.out("Cancelled")
    return 0
  }
  const body = await uapi(ctx, "Mysql", "create_database", { name })
  if (!body) return 1
  ctx.out(`${Icon.success} Database created: ${name}`)
}

async function dbList(ctx: PluginContext): Promise<number | void> {
  const body = await uapi(ctx, "Mysql", "list_databases")
  if (!body) return 1
  const dbs = (body.data as Array<{ database?: string }>) ?? []
  ctx.out(`${Icon.info} Databases (${dbs.length}):`)
  for (const db of dbs) ctx.out(`  ${db.database ?? "?"}`)
}

async function dbDelete(ctx: PluginContext): Promise<number | void> {
  const name = typeof ctx.flags.name === "string" ? ctx.flags.name : ctx.args[0]
  if (!name) {
    ctx.err("Usage: nexus cpanel db:delete --name old_db --confirm")
    return 1
  }
  if (!ctx.flags.confirm) {
    ctx.err("Refusing to delete without --confirm")
    return 1
  }
  const ok = await ctx.confirm({
    title: `Delete database '${name}'?`,
    detail: "This cannot be undone",
    danger: true,
  })
  if (!ok) {
    ctx.out("Cancelled")
    return 0
  }
  const body = await uapi(ctx, "Mysql", "delete_database", { name })
  if (!body) return 1
  ctx.out(`${Icon.success} Database deleted: ${name}`)
}

async function domainAddSubdomain(ctx: PluginContext): Promise<number | void> {
  const name = typeof ctx.flags.name === "string" ? ctx.flags.name : undefined
  const domain = typeof ctx.flags.domain === "string" ? ctx.flags.domain : undefined
  if (!name || !domain) {
    ctx.err("Usage: nexus cpanel domain:add-subdomain --name blog --domain example.com")
    return 1
  }
  const ok = await ctx.confirm({
    title: `Add subdomain '${name}.${domain}'?`,
    detail: "This performs a remote write on your hosting account",
  })
  if (!ok) {
    ctx.out("Cancelled")
    return 0
  }
  const body = await uapi(ctx, "DomainInfo", "add_subdomain", { domain: name, rootdomain: domain, dir: name })
  if (!body) return 1
  ctx.out(`${Icon.success} Subdomain added: ${name}.${domain}`)
}

async function fileList(ctx: PluginContext): Promise<number | void> {
  const dirPath = typeof ctx.flags.path === "string" ? ctx.flags.path : "/public_html"
  const body = await uapi(ctx, "Fileman", "listfiles", { dir: dirPath, types: "dir,file" })
  if (!body) return 1
  const entries = (body.data as Array<{ file?: string; type?: string }>) ?? []
  ctx.out(`${Icon.info} ${dirPath} (${entries.length} entries):`)
  for (const entry of entries.slice(0, 100)) {
    ctx.out(`  [${entry.type === "dir" ? "d" : "f"}] ${entry.file ?? "?"}`)
  }
}

async function sslInstall(ctx: PluginContext): Promise<number | void> {
  const domain = typeof ctx.flags.domain === "string" ? ctx.flags.domain : ctx.args[0]
  if (!domain) {
    ctx.err("Usage: nexus cpanel ssl:install --domain example.com")
    return 1
  }
  const ok = await ctx.confirm({
    title: `Install SSL for '${domain}'?`,
    detail: "This triggers AutoSSL on your hosting account",
  })
  if (!ok) {
    ctx.out("Cancelled")
    return 0
  }
  const body = await uapi(ctx, "SSL", "install_ssl_for_domain", { domain })
  if (!body) return 1
  ctx.out(`${Icon.success} SSL install triggered for ${domain}`)
}

const plugin: NexusPlugin = {
  name: "cpanel",
  version: "0.1.0",
  description: "cPanel hosting management via official UAPI (API token auth only)",
  tags: ["hosting", "database", "domain", "ssl"],
  commands: [
    { name: "connect", describe: "connect to a cPanel host using an API token (never a password)", usage: "nexus cpanel connect --host <host> --user <user>", run: connect },
    { name: "disconnect", describe: "remove the stored cPanel connection and token", usage: "nexus cpanel disconnect", run: disconnect },
    { name: "db:create", describe: "create a MySQL database via UAPI", usage: "nexus cpanel db:create --name mydb", run: dbCreate },
    { name: "db:list", describe: "list databases", usage: "nexus cpanel db:list", run: dbList },
    { name: "db:delete", describe: "delete a database (--confirm required)", usage: "nexus cpanel db:delete --name old_db --confirm", run: dbDelete },
    { name: "domain:add-subdomain", describe: "add a subdomain", usage: "nexus cpanel domain:add-subdomain --name blog --domain example.com", run: domainAddSubdomain },
    { name: "file:list", describe: "list files over UAPI Fileman", usage: "nexus cpanel file:list --path /public_html", run: fileList },
    { name: "ssl:install", describe: "request AutoSSL install for a domain", usage: "nexus cpanel ssl:install --domain example.com", run: sslInstall },
  ],
}

export default plugin

export * as CpanelPlugin from "./cpanel"
