// unsloth-lite: local LLM backend connector for NEXUS autofarm
// Inspired by https://github.com/unslothai/unsloth
//
// Auto-detects local OpenAI-compatible servers (unsloth, ollama, llama.cpp,
// vLLM, LM Studio) and registers them as vault providers so the autofarm
// pipeline can use them as a free-tier backend when the cloud is exhausted.
//
// Usage:
//   import { detectLocalServers, registerLocalProviders } from "./lib/local-llm.ts"
//   const found = await detectLocalServers()
//   for (const s of found) registerLocalProviders([s])

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { log } from "./logger.ts"

export interface LocalServer {
  name: "unsloth" | "ollama" | "llama.cpp" | "vllm" | "lmstudio" | "unknown"
  baseUrl: string
  version?: string
  models: { id: string; size?: number; quantization?: string }[]
  healthy: boolean
  latencyMs: number
}

const PROBES: { name: LocalServer["name"]; baseUrl: string; modelsPath: string }[] = [
  { name: "ollama",   baseUrl: "http://127.0.0.1:11434",  modelsPath: "/api/tags" },
  { name: "llama.cpp",baseUrl: "http://127.0.0.1:8080",   modelsPath: "/v1/models" },
  { name: "vllm",     baseUrl: "http://127.0.0.1:8000",   modelsPath: "/v1/models" },
  { name: "lmstudio", baseUrl: "http://127.0.0.1:1234",   modelsPath: "/v1/models" },
  { name: "unsloth",  baseUrl: "http://127.0.0.1:11435",  modelsPath: "/v1/models" },
]

const DEFAULT_TIMEOUT_MS = 3_000

interface ProbeResult {
  ok: boolean
  server?: LocalServer
  error?: string
}

async function probeOne(p: typeof PROBES[number], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ProbeResult> {
  const t0 = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const url = `${p.baseUrl}${p.modelsPath}`
    const r = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` }
    const data = (await r.json().catch(() => ({}))) as { data?: unknown[]; models?: unknown[]; models_info?: Record<string, unknown> }
    // Ollama format: { models: [{ name, size, ... }] }
    // OpenAI format: { data: [{ id, ... }] }
    const list = Array.isArray(data.models) ? data.models : Array.isArray(data.data) ? data.data : []
    const models = list.map((m) => {
      const obj = m as Record<string, unknown>
      return {
        id: (obj.id ?? obj.name ?? "unknown") as string,
        size: typeof obj.size === "number" ? obj.size : undefined,
        quantization: (obj.quantization_level ?? obj.details) as string | undefined,
      }
    })
    return {
      ok: true,
      server: {
        name: p.name,
        baseUrl: p.baseUrl,
        models,
        healthy: true,
        latencyMs: Date.now() - t0,
      },
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Scan common local LLM server ports. Returns only healthy servers. */
export async function detectLocalServers(): Promise<LocalServer[]> {
  const results = await Promise.all(PROBES.map((p) => probeOne(p)))
  const healthy: LocalServer[] = []
  for (const r of results) {
    if (r.ok && r.server) {
      log.info("local-llm", `found ${r.server.name} at ${r.server.baseUrl} (${r.server.models.length} models, ${r.server.latencyMs}ms)`)
      healthy.push(r.server)
    }
  }
  return healthy
}

/** Quick liveness check on a single URL. */
export async function isReachable(baseUrl: string, timeoutMs = 2_000): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const r = await fetch(baseUrl, { signal: controller.signal })
    clearTimeout(timer)
    return r.ok || r.status < 500
  } catch {
    return false
  }
}

/** Pick the smallest local model — useful as a default for low-power devices. */
export function pickCheapestModel(servers: LocalServer[]): { server: LocalServer; model: string } | null {
  const flat: { server: LocalServer; model: { id: string; size?: number } }[] = []
  for (const s of servers) for (const m of s.models) flat.push({ server: s, model: m })
  if (flat.length === 0) return null
  flat.sort((a, b) => (a.model.size ?? 0) - (b.model.size ?? 0))
  return { server: flat[0].server, model: flat[0].model.id }
}

/** Build the OpenAI-compatible request body for a chat completion. */
export function buildLocalChatRequest(model: string, messages: { role: string; content: string }[]): { model: string; messages: { role: string; content: string }[]; max_tokens: number } {
  return { model, messages, max_tokens: 1024 }
}

/** Send a chat completion to a local server. */
export async function chatLocal(
  server: LocalServer,
  model: string,
  messages: { role: string; content: string }[],
  timeoutMs = 60_000,
): Promise<{ content: string; latencyMs: number }> {
  const t0 = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const r = await fetch(`${server.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildLocalChatRequest(model, messages)),
      signal: controller.signal,
    })
    if (!r.ok) throw new Error(`local LLM HTTP ${r.status}`)
    const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return { content: j.choices?.[0]?.message?.content ?? "", latencyMs: Date.now() - t0 }
  } finally {
    clearTimeout(timer)
  }
}

/** Add the discovered local servers to the vault as "free" providers. */
export function registerLocalProviders(servers: LocalServer[]): { added: string[]; skipped: string[] } {
  const vp = path.join(os.homedir(), ".nexus", "api-vault.json")
  let vault: { providers: Record<string, unknown[]> } = { providers: {} }
  try { if (fs.existsSync(vp)) vault = JSON.parse(fs.readFileSync(vp, "utf8")) } catch {}
  if (!vault.providers) vault.providers = {}
  const added: string[] = []
  const skipped: string[] = []
  for (const s of servers) {
    const providerId = `local-${s.name}`
    if ((vault.providers[providerId] ?? []).length > 0) {
      skipped.push(providerId)
      continue
    }
    vault.providers[providerId] = [{
      key: `local-${s.baseUrl}`,
      label: `${s.name}@${s.baseUrl}`,
      added: new Date().toISOString().slice(0, 10),
      status: "active",
      failures: 0,
      source: "farm",
      lastChecked: new Date().toISOString(),
    }]
    added.push(providerId)
  }
  if (added.length) {
    fs.mkdirSync(path.dirname(vp), { recursive: true })
    fs.writeFileSync(vp, JSON.stringify(vault, null, 2))
  }
  return { added, skipped }
}
