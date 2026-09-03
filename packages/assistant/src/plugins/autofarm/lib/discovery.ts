// Multi-source free LLM provider discovery
// Sources: HackerNews (Algolia), GitHub trending, DuckDuckGo, RSS feeds
//
// Why: previously only DuckDuckGo was scraped. Real demand-supply needs
// multiple independent sources to find newly-launched free tiers fast.

export interface ProviderCandidate {
  source: "hackernews" | "github" | "duckduckgo" | "rss" | "manual"
  title: string
  url: string
  snippet?: string
  score?: number // HN points, GH stars, etc.
  discoveredAt: number
  tags: string[]
}

const HN_BASE = "https://hn.algolia.com/api/v1/search"
const GH_TRENDING = "https://api.github.com/search/repositories"
const DDG_HTML = "https://html.duckduckgo.com/html/"

const SEARCH_QUERIES = [
  "free LLM API key no credit card",
  "free AI inference API",
  "openai compatible free API",
  "free tier LLM provider",
  "free groq alternative",
]

const USER_AGENTS = [
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function isProviderRelevant(text: string): boolean {
  const t = text.toLowerCase()
  return /llm|ai|model|inference|api|key|free|openai|groq|claude|gemini|cerebras|together|fireworks|replicate|perplexity|cohere|mistral|deepseek|huggingface|openrouter/.test(t) &&
    !/tutorial|course|news|article|opinion|review|comparison|vs\./i.test(t)
}

function extractTags(text: string): string[] {
  const t = text.toLowerCase()
  const tags: string[] = []
  const providers = ["groq", "cerebras", "openrouter", "together", "fireworks", "mistral", "anthropic", "claude", "openai", "gpt", "gemini", "replicate", "perplexity", "cohere", "deepseek", "huggingface"]
  for (const p of providers) if (t.includes(p)) tags.push(p)
  if (/free\s*tier|no\s*credit\s*card|free\s*api/i.test(t)) tags.push("free-tier")
  if (/openai\s*compatible|chat\s*completions/i.test(t)) tags.push("openai-compatible")
  return tags
}

// ── HackerNews (Algolia) ────────────────────────────────────────────
async function searchHackerNews(query: string, timeoutMs = 8_000): Promise<ProviderCandidate[]> {
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    const url = `${HN_BASE}?query=${encodeURIComponent(query)}&tags=story&numericFilters=points%3E%3D5`
    const r = await fetch(url, { headers: { "User-Agent": pick(USER_AGENTS) }, signal: ctl.signal })
    clearTimeout(timer)
    if (!r.ok) return []
    const data = (await r.json()) as { hits?: Array<{ title: string; url?: string; story_text?: string; points: number; created_at_i: number; objectID: string }> }
    const out: ProviderCandidate[] = []
    for (const h of (data.hits ?? []).slice(0, 10)) {
      if (!h.url) continue
      if (!isProviderRelevant(h.title)) continue
      out.push({
        source: "hackernews",
        title: h.title,
        url: h.url,
        snippet: h.story_text?.replace(/<[^>]+>/g, "").slice(0, 300),
        score: h.points,
        discoveredAt: Date.now(),
        tags: extractTags(h.title + " " + (h.story_text ?? "")),
      })
    }
    return out
  } catch {
    return []
  }
}

// ── GitHub trending ─────────────────────────────────────────────────
async function searchGitHubTrending(query: string, timeoutMs = 8_000): Promise<ProviderCandidate[]> {
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    const url = `${GH_TRENDING}?q=${encodeURIComponent(query + " in:readme")}&sort=stars&order=desc&per_page=10`
    const r = await fetch(url, { headers: { "User-Agent": "nexus-autofarm/0.2", Accept: "application/vnd.github+json" }, signal: ctl.signal })
    clearTimeout(timer)
    if (!r.ok) return []
    const data = (await r.json()) as { items?: Array<{ full_name: string; html_url: string; description?: string; stargazers_count: number; created_at: string }> }
    const out: ProviderCandidate[] = []
    for (const it of (data.items ?? [])) {
      if (!isProviderRelevant(it.full_name + " " + (it.description ?? ""))) continue
      out.push({
        source: "github",
        title: `${it.full_name} — ${it.description ?? ""}`,
        url: it.html_url,
        snippet: (it.description ?? "").slice(0, 300),
        score: it.stargazers_count,
        discoveredAt: Date.now(),
        tags: extractTags(it.full_name + " " + (it.description ?? "")),
      })
    }
    return out
  } catch {
    return []
  }
}

// ── DuckDuckGo HTML scrape ──────────────────────────────────────────
async function searchDuckDuckGo(query: string, timeoutMs = 8_000): Promise<ProviderCandidate[]> {
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    const url = `${DDG_HTML}?q=${encodeURIComponent(query)}`
    const r = await fetch(url, { headers: { "User-Agent": pick(USER_AGENTS) }, signal: ctl.signal })
    clearTimeout(timer)
    if (!r.ok) return []
    const html = await r.text()
    const out: ProviderCandidate[] = []
    const re = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g
    let m: RegExpExecArray | null
    let count = 0
    while ((m = re.exec(html)) && count < 15) {
      const link = m[1]
      const title = m[2]
      if (!isProviderRelevant(title)) continue
      out.push({
        source: "duckduckgo",
        title,
        url: link,
        discoveredAt: Date.now(),
        tags: extractTags(title),
      })
      count++
    }
    return out
  } catch {
    return []
  }
}

/** Run all sources in parallel and dedupe by URL. */
export async function discoverAll(timeoutMs = 12_000): Promise<ProviderCandidate[]> {
  const tasks: Promise<ProviderCandidate[]>[] = []
  for (const q of SEARCH_QUERIES) {
    tasks.push(searchHackerNews(q, timeoutMs))
    tasks.push(searchGitHubTrending(q, timeoutMs))
    tasks.push(searchDuckDuckGo(q, timeoutMs))
  }
  const results = await Promise.all(tasks)
  const flat = results.flat()
  // Dedupe by URL (same link from multiple sources)
  const seen = new Map<string, ProviderCandidate>()
  for (const c of flat) {
    const existing = seen.get(c.url)
    if (!existing) {
      seen.set(c.url, c)
    } else {
      // Merge: keep highest score, union tags
      existing.score = Math.max(existing.score ?? 0, c.score ?? 0)
      existing.tags = Array.from(new Set([...existing.tags, ...c.tags]))
    }
  }
  return Array.from(seen.values()).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
}

/** Search a single source for testing. */
export async function discoverOne(source: "hackernews" | "github" | "duckduckgo", query = SEARCH_QUERIES[0]): Promise<ProviderCandidate[]> {
  switch (source) {
    case "hackernews": return searchHackerNews(query)
    case "github":     return searchGitHubTrending(query)
    case "duckduckgo": return searchDuckDuckGo(query)
  }
}

export const DISCOVERY_QUERIES = SEARCH_QUERIES
