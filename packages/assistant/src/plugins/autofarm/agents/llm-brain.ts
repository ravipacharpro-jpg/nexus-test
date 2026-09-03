// Upgrade 5: LLM-powered decision agent
// Replaces the hardcoded decision tree in orchestrator.ts with
// reasoning calls to whatever LLM is currently available in the
// vault. Uses a tiny structured prompt so the response can be parsed
// reliably as JSON.
//
// Why: instead of "if ratio < 0.3 then farm" we ask
//   "given the current vault, usage, and system load,
//    which 2-3 providers should we farm now, and why?"
// The LLM can factor in things a rules engine can't easily encode
// (e.g. "groq 8B context is exhausted but 70B has capacity, prefer 70B").

import { listProviders } from "./provider-agent.ts"
import { snapshot } from "./monitor-agent.ts"
import { predictAll } from "../lib/predictor.ts"
import { topProvidersForTask } from "../lib/selector.ts"
import { pickKeyForTask } from "../lib/selector.ts"
import { vaultSummary } from "../lib/vault.ts"
import { log } from "../lib/logger.ts"

export interface LLMDecision {
  action: "farm" | "rest" | "rotate" | "switch" | "wait"
  reason: string
  providers: string[]   // providers to farm
  urgency: 1 | 2 | 3 | 4 | 5
  tasks: TaskHint[]
}

export interface TaskHint {
  task: string
  preferredProvider: string
  reason: string
}

/** Build a structured prompt for the LLM. */
export function buildPrompt(): string {
  const mon = snapshot()
  const sum = vaultSummary()
  const catalog = listProviders().filter((p) => p.freePerDay && p.freePerDay > 0)
  const predictions = predictAll(catalog, mon.usage)
  const topCode = topProvidersForTask("code", 3)
  const topChat = topProvidersForTask("chat", 3)

  return `You are the brain of an autonomous API-key farmer called "autofarm".
You run inside NEXUS and your job is to keep the local vault full of
working free-tier API keys, so the user never runs out of LLM capacity.

# Current state
- Vault: ${sum.providers} providers, ${sum.activeKeys}/${sum.totalKeys} active keys
- System load: ${mon.load.loadLevel} (cpu=${mon.load.cpu.toFixed(2)})
- Predicted exhaustions (top 5):
${predictions
  .slice(0, 5)
  .map((p) => `  - ${p.provider}: used=${p.currentDaily}/${p.freePerDay} daysToExhaust=${p.daysToExhaust} conf=${p.confidence}`)
  .join("\n")}

# Available free providers (sample of 13)
${catalog.map((p) => `  - ${p.id}: freePerDay=${p.freePerDay}, freePerMin=${p.freePerMin}, signup=${p.signupUrl}`).join("\n")}

# Top providers by task
- code: ${topCode.map((p) => `${p.provider}(${p.taskScore})`).join(", ")}
- chat: ${topChat.map((p) => `${p.provider}(${p.taskScore})`).join(", ")}

# Decision required
Return ONE JSON object with this exact shape and nothing else:
{
  "action": "farm" | "rest" | "rotate" | "switch" | "wait",
  "reason": "1-2 sentence explanation",
  "providers": ["<provider-id>", ...],   // 0..3 providers
  "urgency": 1..5,
  "tasks": [
    { "task": "code" | "chat" | "vision" | "long-context",
      "preferredProvider": "<provider-id>",
      "reason": "1 sentence" }
  ]
}

Constraints:
- urgency 5 = critical (vault nearly empty, must farm now)
- urgency 1 = low (everything healthy, can rest)
- providers list should not be empty if action="farm"
- respect system load: if load is "high" or "critical", set urgency <= 2
- never pick a provider that is already in the cooldown list
- prefer providers that the user likely needs (code, chat) over niche ones`
}

/**
 * Run the brain. Uses a healthy key from the vault as the reasoning
 * engine. If the vault is empty, returns a "rest" decision.
 */
export async function runBrain(): Promise<LLMDecision> {
  const fallback: LLMDecision = {
    action: "rest",
    reason: "no healthy key in vault to reason with",
    providers: [],
    urgency: 1,
    tasks: [],
  }
  const reasoning = pickKeyForTask("any")
  if (!reasoning) return fallback

  const prompt = buildPrompt()
  try {
    const text = await callReasoningLLM(reasoning.provider, reasoning.key, prompt)
    const parsed = parseDecision(text)
    if (parsed) {
      log.info(`llm-brain: decision=${parsed.action} urgency=${parsed.urgency} providers=[${parsed.providers.join(",")}]`)
      return parsed
    }
    log.warn("llm-brain: failed to parse LLM response, falling back to rest")
  } catch (e) {
    log.error(`llm-brain error: ${(e as Error).message}`)
  }
  return fallback
}

async function callReasoningLLM(provider: string, key: string, prompt: string): Promise<string> {
  // Most providers we support expose an OpenAI-compatible /v1/chat/completions.
  // We keep this simple and avoid pulling the AI SDK so the brain works
  // even in low-dependency contexts.
  const baseUrls: Record<string, string> = {
    openrouter: "https://openrouter.ai/api/v1",
    groq: "https://api.groq.com/openai/v1",
    cerebras: "https://api.cerebras.ai/v1",
    together_ai: "https://api.together.xyz/v1",
    fireworks_ai: "https://api.fireworks.ai/inference/v1",
    mistral: "https://api.mistral.ai/v1",
    deepseek: "https://api.deepseek.com/v1",
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com/v1",
  }
  const url = baseUrls[provider]
  if (!url) throw new Error(`no reasoning endpoint for ${provider}`)

  // small cheap model for decision
  const model = provider === "anthropic" ? "claude-haiku-4-5" : "gpt-4o-mini"
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    let resp: Response
    if (provider === "anthropic") {
      resp = await fetch(`${url}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 512,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      })
      const j = (await resp.json()) as { content?: Array<{ text?: string }> }
      return j.content?.[0]?.text ?? ""
    }
    resp = await fetch(`${url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 512,
        temperature: 0.2,
      }),
      signal: controller.signal,
    })
    const j = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return j.choices?.[0]?.message?.content ?? ""
  } finally {
    clearTimeout(timer)
  }
}

export function parseDecision(text: string): LLMDecision | null {
  // Extract first {...} block
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end < 0 || end <= start) return null
  const slice = text.slice(start, end + 1)
  try {
    const obj = JSON.parse(slice) as LLMDecision
    if (!["farm", "rest", "rotate", "switch", "wait"].includes(obj.action)) return null
    if (typeof obj.reason !== "string") obj.reason = ""
    if (!Array.isArray(obj.providers)) obj.providers = []
    if (typeof obj.urgency !== "number" || obj.urgency < 1 || obj.urgency > 5) obj.urgency = 3
    if (!Array.isArray(obj.tasks)) obj.tasks = []
    return obj
  } catch {
    return null
  }
}
