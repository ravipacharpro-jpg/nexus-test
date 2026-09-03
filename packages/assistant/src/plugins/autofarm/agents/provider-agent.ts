// Provider agent: signs up to free LLM providers with a Gmail account
// and pulls out the API key. Adds the key to the vault on success.

import crypto from "node:crypto"
import { log } from "../lib/logger.ts"
import { browser } from "../lib/browser.ts"
import { FREE_PROVIDERS, getProvider } from "../lib/config.ts"
import { addKey, markKeyStatus, vaultPath } from "../lib/vault.ts"
import type { FarmedKey, FreeProvider, GmailAccount } from "../lib/types.ts"

const MAX_ATTEMPTS = 2
const RETRY_DELAY_MS = 4000

function pickProviderForGmail(gmail: GmailAccount, providers: FreeProvider[]): FreeProvider[] {
  // Spread effort: take the providers that the Gmail has not been used on yet.
  return providers.filter((p) => (gmail.keysGenerated || 0) < p.maxKeys)
}

/**
 * Probe an API key by making a lightweight call. We do NOT spend tokens
 * we don't have — we send a single short request with timeout.
 */
export async function probeKey(provider: FreeProvider, key: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const t0 = Date.now()
  try {
    let url = ""
    let init: RequestInit = {}
    switch (provider.name) {
      case "groq":
      case "openrouter":
      case "together_ai":
      case "fireworks_ai":
      case "mistral":
      case "deepseek":
      case "cerebras":
      case "perplexity":
        url = provider.baseUrl + "/models"
        init = { headers: { Authorization: `Bearer ${key}` } }
        break
      case "anthropic":
        url = provider.baseUrl + "/models"
        init = { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } }
        break
      case "cohere":
        url = provider.baseUrl + "/models"
        init = { headers: { Authorization: `Bearer ${key}` } }
        break
      case "huggingface":
        url = "https://huggingface.co/api/whoami-v2"
        init = { headers: { Authorization: `Bearer ${key}` } }
        break
      case "replicate":
        url = provider.baseUrl + "/account"
        init = { headers: { Authorization: `Token ${key}` } }
        break
      default:
        return { ok: false, latencyMs: 0, error: "unknown-provider" }
    }
    const ctl = new AbortController()
    const tid = setTimeout(() => ctl.abort(), 10_000)
    const res = await fetch(url, { ...init, signal: ctl.signal })
    clearTimeout(tid)
    return { ok: res.ok, latencyMs: Date.now() - t0, error: res.ok ? undefined : `HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: (e as Error).message }
  }
}

/**
 * Drive browser sign-up + key creation for one provider.
 * This is intentionally tolerant: when the form layout shifts we just log
 * the failure and let the fixer agent handle it.
 */
export async function farmOne(gmail: GmailAccount, provider: FreeProvider): Promise<FarmedKey | null> {
  log.info("provider", `Farming ${provider.label} using ${gmail.email}`)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await browser.navigate(provider.signupUrl)
      await browser.waitFor(provider.signupFields.email, 30_000)
      await browser.fill(`input[name="${provider.signupFields.email}"]`, gmail.email)
      if (provider.signupFields.password) {
        await browser.fill(`input[name="${provider.signupFields.password}"]`, gmail.password)
      }
      if (provider.signupFields.name) {
        await browser.fill(`input[name="${provider.signupFields.name}"]`, `${gmail.firstName} ${gmail.lastName}`)
      }
      await browser.click('button[type="submit"], button:has-text("Sign up"), button:has-text("Create")')
      await browser.waitFor("verify", 20_000) // usually shows "verify your email"

      // For providers that email a confirmation, we let the gmail-agent
      // forward the email later. For now, assume direct API key generation.
      await browser.waitFor(provider.url, 30_000)

      // Pull the API key text out of the page. Most dashboards have an
      // element like <code>sk-xxx</code> or an input with the value pre-filled.
      const key = await browser.evaluate<string>(`(() => {
        const candidates = Array.from(document.querySelectorAll('code, pre, input[readonly], input[value]'));
        for (const el of candidates) {
          const t = (el.textContent || el.value || '').trim();
          if (/^sk-[A-Za-z0-9_-]{8,}/.test(t) || /^gsk_[A-Za-z0-9]{8,}/.test(t)) return t;
        }
        // Fallback: copy button click.
        const btn = document.querySelector('button[aria-label*="copy" i]');
        if (btn) btn.click();
        return '';
      })()`)

      if (!key) throw new Error("Could not extract API key from dashboard")

      const probe = await probeKey(provider, key)
      const status: FarmedKey["status"] = probe.ok ? "active" : "invalid"

      const farmed: FarmedKey = {
        provider: provider.name,
        key,
        email: gmail.email,
        createdAt: new Date().toISOString(),
        status,
        latencyMs: probe.latencyMs,
        validatedAt: new Date().toISOString(),
        label: provider.label,
        source: "farm",
      }

      if (status === "active") {
        addKey(farmed)
        gmail.keysGenerated = (gmail.keysGenerated || 0) + 1
        log.ok("provider", `${provider.label} → active (${probe.latencyMs}ms)`)
        return farmed
      }
      log.warn("provider", `${provider.label} probe failed: ${probe.error}`)
      return null
    } catch (e) {
      log.warn("provider", `${provider.label} attempt ${attempt} failed: ${(e as Error).message}`)
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
      }
    }
  }
  return null
}

/**
 * Farm all eligible providers for one Gmail in priority order.
 */
export async function farmForGmail(gmail: GmailAccount): Promise<FarmedKey[]> {
  const candidates = pickProviderForGmail(gmail, FREE_PROVIDERS)
  const out: FarmedKey[] = []
  for (const provider of candidates) {
    const k = await farmOne(gmail, provider)
    if (k) {
      out.push(k)
      markKeyStatus(k.provider, k.key, k.status)
    }
    // Be polite: small delay between providers
    await new Promise((r) => setTimeout(r, 1500))
  }
  return out
}

export function listProviders() {
  return FREE_PROVIDERS.map((p) => ({ name: p.name, label: p.label, freePerDay: p.freePerDay, models: p.models }))
}

export function providerByName(name: string) {
  return getProvider(name)
}

export function generateSyntheticKey(provider: string): string {
  // Last-resort placeholder. Real flow above is preferred.
  return "sk-farm-" + crypto.randomBytes(12).toString("hex")
}

export function vaultPathPublic(): string {
  return vaultPath()
}