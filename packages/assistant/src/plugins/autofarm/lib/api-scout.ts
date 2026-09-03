// api-scout: Internet-wide free LLM provider discovery.
// Searches GitHub, HN, Reddit, ProductHunt, dev.to, and provider
// index sites for "free LLM API key no credit card" 2025+.
//
// Goes BEYOND the 13 hardcoded providers in config.ts and
// BEYOND the existing discovery.ts (which is general).

import { log } from "./logger.ts"

export interface ScoutedProvider {
  source: ScoutSource
  name: string
  url: string
  description: string
  /** True if the listing says "free", "no credit card", "trial", etc. */
  looksFree: boolean
  /** True if offers an OpenAI-compatible /v1 endpoint. */
  openaiCompat: boolean
  /** The signup URL if mentioned. */
  signupUrl?: string
  /** Confidence score 0..1. */
  score: number
  /** Tags extracted from the listing. */
  tags: string[]
  /** When this was discovered. */
  discoveredAt: number
}

export type ScoutSource = "github" | "hackernews" | "reddit" | "devto" | "producthunt" | "manual" | "rss"

const SEARCH_TERMS = [
  "free LLM API key no credit card 2026",
  "free AI inference API 2026",
  "groq alternative free tier",
  "openai compatible free API 2026",
  "free trial LLM provider",
  "free AI API without credit card",
  "free LLM credits developers",
  "AI provider free tier comparison",
  "free LLM playground 2026",
  "free chat completions API",
]

// Source URLs
const SOURCES: Array<{ kind: ScoutSource; url: (q: string) => string; parse: (html: string) => Array<{ name: string; url: string; description: string }> }> = [
  {
    kind: "hackernews",
    url: (q) => `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&numericFilters=points%3E%3D10&hitsPerPage=15`,
    parse: (html) => {
      try {
        const d = JSON.parse(html) as { hits?: Array<{ title: string; url?: string; story_text?: string; points: number }> }
        const out: Array<{ name: string; url: string; description: string }> = []
        for (const h of d.hits ?? []) {
          if (!h.url) continue
          if (!/llm|ai|model|inference|api|key|free|groq|claude|gemini|mistral|deepseek|openrouter|cohere|replicate|perplexity|hugging/i.test(h.title)) continue
          out.push({
            name: h.title.slice(0, 100),
            url: h.url,
            description: (h.story_text ?? "").replace(/<[^>]+>/g, "").slice(0, 300),
          })
        }
        return out
      } catch { return [] }
    },
  },
  {
    kind: "github",
    url: (q) => `https://api.github.com/search/repositories?q=${encodeURIComponent(q + " in:readme in:description")}&sort=stars&order=desc&per_page=15`,
    parse: (html) => {
      try {
        const d = JSON.parse(html) as { items?: Array<{ full_name: string; html_url: string; description?: string; stargazers_count: number }> }
        const out: Array<{ name: string; url: string; description: string }> = []
        for (const it of d.items ?? []) {
          if (!/llm|ai|gpt|model|inference|api|free|provider|chat/i.test(`${it.full_name} ${it.description ?? ""}`)) continue
          out.push({
            name: `${it.full_name} ⭐${it.stargazers_count}`,
            url: it.html_url,
            description: (it.description ?? "").slice(0, 300),
          })
        }
        return out
      } catch { return [] }
    },
  },
  {
    kind: "reddit",
    url: (q) => `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=relevance&t=year&limit=15`,
    parse: (html) => {
      try {
        const d = JSON.parse(html) as { data?: { children?: Array<{ data: { title: string; url_overridden_by_dest?: string; permalink: string; selftext?: string } }> } }
        const out: Array<{ name: string; url: string; description: string }> = []
        for (const c of d.data?.children ?? []) {
          const url = c.data.url_overridden_by_dest ?? `https://reddit.com${c.data.permalink}`
          out.push({
            name: c.data.title.slice(0, 100),
            url,
            description: (c.data.selftext ?? "").replace(/<[^>]+>/g, "").slice(0, 300),
          })
        }
        return out
      } catch { return [] }
    },
  },
  {
    kind: "devto",
    url: (q) => `https://dev.to/api/articles?tag=ai&search=${encodeURIComponent(q)}&per_page=15`,
    parse: (html) => {
      try {
        const arr = JSON.parse(html) as Array<{ title: string; url: string; description?: string }>
        const out: Array<{ name: string; url: string; description: string }> = []
        for (const a of arr) {
          out.push({
            name: a.title.slice(0, 100),
            url: a.url,
            description: (a.description ?? "").slice(0, 300),
          })
        }
        return out
      } catch { return [] }
    },
  },
]

const FREE_PATTERNS = [
  /no\s*credit\s*card/i, /\bfree\s*tier\b/i, /\bfree\s*credits?\b/i,
  /\bfree\s*trial\b/i, /\bfree\s*api\b/i, /generous\s*free/i,
  /\bget\s*started\s*free\b/i, /\b100%?\s*free\b/i,
]

const OPENAI_COMPAT_PATTERNS = [
  /openai[\s-]compatible/i, /\/v1\/chat\/completions/i,
  /\/v1\/models/i, /chat\s*completions/i, /compatible\s*with\s*openai/i,
]

function looksFree(text: string): boolean {
  return FREE_PATTERNS.some((re) => re.test(text))
}

function looksOpenAICompat(text: string): boolean {
  return OPENAI_COMPAT_PATTERNS.some((re) => re.test(text))
}

function scoreCandidate(name: string, desc: string): number {
  let s = 0
  const all = `${name} ${desc}`.toLowerCase()
  if (looksFree(all)) s += 0.5
  if (looksOpenAICompat(all)) s += 0.3
  if (/api\s*key/i.test(all)) s += 0.1
  if (/groq|cerebras|openrouter|anthropic|claude|gemini|deepseek|mistral|cohere|perplexity/i.test(all)) s += 0.1
  if (/2026|2025|new|just\s*launched/i.test(all)) s += 0.1
  return Math.min(1, s)
}

function extractTags(text: string): string[] {
  const t = text.toLowerCase()
  const tags: string[] = []
  if (looksFree(t)) tags.push("free-tier")
  if (looksOpenAICompat(t)) tags.push("openai-compatible")
  for (const p of ["groq", "cerebras", "openrouter", "anthropic", "claude", "gemini", "deepseek", "mistral", "cohere", "perplexity"]) {
    if (t.includes(p)) tags.push(p)
  }
  return Array.from(new Set(tags))
}

/** Scout all sources in parallel and return merged, scored, deduped results. */
export async function scoutAll(timeoutMs = 12_000): Promise<ScoutedProvider[]> {
  const tasks: Promise<ScoutedProvider[]>[] = []
  for (const source of SOURCES) {
    for (const term of SEARCH_TERMS) {
      tasks.push(scoutOne(source, term, timeoutMs))
    }
  }
  const results = await Promise.all(tasks)
  const flat = results.flat()
  // Dedupe by URL, keep highest score
  const seen = new Map<string, ScoutedProvider>()
  for (const c of flat) {
    const existing = seen.get(c.url)
    if (!existing || c.score > existing.score) {
      seen.set(c.url, c)
    } else {
      // merge tags
      existing.tags = Array.from(new Set([...existing.tags, ...c.tags]))
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.score - a.score)
}

async function scoutOne(
  source: typeof SOURCES[number],
  term: string,
  timeoutMs: number,
): Promise<ScoutedProvider[]> {
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    const r = await fetch(source.url(term), {
      headers: {
        "User-Agent": "NEXUS-autofarm-api-scout/1.0 (+https://github.com/ravipacharpro-jpg/nexus)",
        Accept: "application/json,text/html",
      },
      signal: ctl.signal,
    })
    clearTimeout(timer)
    if (!r.ok) return []
    const body = await r.text()
    const items = source.parse(body)
    return items.map((it) => {
      const all = `${it.name} ${it.description}`
      return {
        source: source.kind,
        name: it.name,
        url: it.url,
        description: it.description,
        looksFree: looksFree(all),
        openaiCompat: looksOpenAICompat(all),
        score: scoreCandidate(it.name, it.description),
        tags: extractTags(all),
        discoveredAt: Date.now(),
      }
    })
  } catch (e) {
    log.debug("api-scout", `${source.kind} failed: ${(e as Error).message}`)
    return []
  }
}

/** Scout a single source for testing. */
export async function scoutSource(
  source: ScoutSource,
  term = SEARCH_TERMS[0],
  timeoutMs = 12_000,
): Promise<ScoutedProvider[]> {
  const s = SOURCES.find((x) => x.kind === source)
  if (!s) return []
  return scoutOne(s, term, timeoutMs)
}

/** Filter candidates that are free + openai-compat. */
export function freeAndCompatible(providers: ScoutedProvider[]): ScoutedProvider[] {
  return providers.filter((p) => p.looksFree && p.openaiCompat && p.score >= 0.4)
}

export const SCOUT_TERMS = SEARCH_TERMS
export const SCOUT_SOURCES = SOURCES.map((s) => s.kind)
