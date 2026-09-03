// Cost tracker for NEXUS autofarm
// Tracks per-call LLM cost in $ based on provider pricing.
// No external API needed — uses a curated pricing table updated periodically.
//
// Usage:
//   import { estimateCost, recordCallCost, dailyCost, monthlyCost } from "./lib/cost.ts"
//   const cost = estimateCost("groq", 1000, 500)  // $X.XX for 1k input + 500 output
//   recordCallCost("groq", "llama-3.1-70b", 1000, 500)
//   console.log(dailyCost())  // $X.XX today
//
// Pricing source: published per-1M-token rates as of late 2025. Free tiers = 0.

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { log } from "./logger.ts"

// Per-1M-token USD prices for free + paid tiers. Free = 0.
// 0 = included in free tier (no cost)
// price = USD per 1_000_000 tokens
export interface ModelPricing {
  inputPerMTok: number
  outputPerMTok: number
  isFree: boolean
  notes?: string
}

const PRICING: Record<string, ModelPricing> = {
  // Free LLM providers (zero cost for free tier)
  "groq":                       { inputPerMTok: 0, outputPerMTok: 0, isFree: true, notes: "Free tier" },
  "cerebras":                   { inputPerMTok: 0, outputPerMTok: 0, isFree: true, notes: "Free tier" },
  "openrouter":                 { inputPerMTok: 0, outputPerMTok: 0, isFree: true, notes: "Free models :free" },
  "together_ai":                { inputPerMTok: 0, outputPerMTok: 0, isFree: true, notes: "Free trial credit" },
  "fireworks_ai":               { inputPerMTok: 0, outputPerMTok: 0, isFree: true, notes: "Free trial credit" },
  "mistral":                    { inputPerMTok: 0, outputPerMTok: 0, isFree: true, notes: "Free tier" },
  "deepseek":                   { inputPerMTok: 0, outputPerMTok: 0, isFree: true, notes: "Free credits" },
  "cohere":                     { inputPerMTok: 0, outputPerMTok: 0, isFree: true, notes: "Free trial" },
  "huggingface":                { inputPerMTok: 0, outputPerMTok: 0, isFree: true, notes: "Free inference" },
  "gemini":                     { inputPerMTok: 0, outputPerMTok: 0, isFree: true, notes: "Free tier" },
  "opencode":                   { inputPerMTok: 0, outputPerMTok: 0, isFree: true, notes: "Keyless local gateway" },
  "local-ollama":               { inputPerMTok: 0, outputPerMTok: 0, isFree: true, notes: "Local model" },
  "local-llama.cpp":            { inputPerMTok: 0, outputPerMTok: 0, isFree: true, notes: "Local model" },
  "local-vllm":                 { inputPerMTok: 0, outputPerMTok: 0, isFree: true, notes: "Local model" },
  "local-lmstudio":             { inputPerMTok: 0, outputPerMTok: 0, isFree: true, notes: "Local model" },
  "local-unsloth":              { inputPerMTok: 0, outputPerMTok: 0, isFree: true, notes: "Local model" },
  // Paid providers (for cost awareness if user upgrades)
  "anthropic:claude-3-5-sonnet":{ inputPerMTok: 3.0,  outputPerMTok: 15.0, isFree: false },
  "anthropic:claude-3-haiku":   { inputPerMTok: 0.25, outputPerMTok: 1.25, isFree: false },
  "openai:gpt-4o":              { inputPerMTok: 5.0,  outputPerMTok: 15.0, isFree: false },
  "openai:gpt-4o-mini":         { inputPerMTok: 0.15, outputPerMTok: 0.6,  isFree: false },
  "openai:o1-preview":          { inputPerMTok: 15.0, outputPerMTok: 60.0, isFree: false },
  "xai:grok-2":                 { inputPerMTok: 5.0,  outputPerMTok: 15.0, isFree: false },
  "perplexity:sonar-pro":       { inputPerMTok: 3.0,  outputPerMTok: 15.0, isFree: false },
}

const COST_LOG = path.join(os.homedir(), ".nexus", "autofarm", "cost-log.jsonl")

export interface CostEntry {
  ts: number
  provider: string
  model?: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  isFree: boolean
}

function lookupPricing(provider: string, model?: string): ModelPricing {
  if (model) {
    const exact = PRICING[`${provider}:${model}`]
    if (exact) return exact
  }
  const p = PRICING[provider]
  if (p) return p
  // Conservative fallback: assume free if provider not in table
  return { inputPerMTok: 0, outputPerMTok: 0, isFree: true, notes: "unknown provider, assumed free" }
}

export function estimateCost(provider: string, inputTokens: number, outputTokens: number, model?: string): { costUsd: number; isFree: boolean; breakdown: { input: number; output: number } } {
  const p = lookupPricing(provider, model)
  const inputCost = (inputTokens / 1_000_000) * p.inputPerMTok
  const outputCost = (outputTokens / 1_000_000) * p.outputPerMTok
  const costUsd = Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000
  return { costUsd, isFree: p.isFree, breakdown: { input: inputCost, output: outputCost } }
}

export function recordCallCost(provider: string, inputTokens: number, outputTokens: number, model?: string): CostEntry {
  const { costUsd, isFree } = estimateCost(provider, inputTokens, outputTokens, model)
  const entry: CostEntry = { ts: Date.now(), provider, model, inputTokens, outputTokens, costUsd, isFree }
  try {
    fs.mkdirSync(path.dirname(COST_LOG), { recursive: true })
    fs.appendFileSync(COST_LOG, JSON.stringify(entry) + "\n", { mode: 0o600 })
  } catch (e) {
    log.warn("cost", `append failed: ${(e as Error).message}`)
  }
  return entry
}

function readEntries(sinceMs: number): CostEntry[] {
  try {
    if (!fs.existsSync(COST_LOG)) return []
    const lines = fs.readFileSync(COST_LOG, "utf8").split(/\r?\n/).filter(Boolean)
    const out: CostEntry[] = []
    for (const l of lines) {
      try {
        const e = JSON.parse(l) as CostEntry
        if (e.ts >= sinceMs) out.push(e)
      } catch {}
    }
    return out
  } catch { return [] }
}

export function dailyCost(dayStart = startOfToday()): { totalUsd: number; freeUsd: number; paidUsd: number; calls: number; byProvider: Record<string, number> } {
  const entries = readEntries(dayStart)
  let totalUsd = 0
  let freeUsd = 0
  let paidUsd = 0
  const byProvider: Record<string, number> = {}
  for (const e of entries) {
    totalUsd += e.costUsd
    if (e.isFree) freeUsd += e.costUsd
    else paidUsd += e.costUsd
    byProvider[e.provider] = (byProvider[e.provider] ?? 0) + e.costUsd
  }
  return { totalUsd: round(totalUsd), freeUsd: round(freeUsd), paidUsd: round(paidUsd), calls: entries.length, byProvider }
}

export function monthlyCost(): ReturnType<typeof dailyCost> {
  const start = new Date()
  start.setDate(1)
  start.setHours(0, 0, 0, 0)
  return dailyCost(start.getTime())
}

export function allTimeCost(): ReturnType<typeof dailyCost> {
  return dailyCost(0)
}

function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000
}

export function costLogPath(): string {
  return COST_LOG
}

export function setPricing(provider: string, model: string, pricing: ModelPricing): void {
  PRICING[`${provider}:${model}`] = pricing
}

export function getPricing(provider: string, model?: string): ModelPricing {
  return lookupPricing(provider, model)
}

export function listPriced(): { provider: string; model: string; pricing: ModelPricing }[] {
  return Object.entries(PRICING).map(([k, p]) => {
    const [provider, model] = k.split(":")
    return { provider, model, pricing: p }
  })
}
