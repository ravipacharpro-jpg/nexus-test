// Fixer agent: detects problems (broken keys, exhausted caps, blocked flows)
// and applies small, reversible remediations.

import { log } from "../lib/logger.ts"
import { loadVault, removeBrokenKeys, saveVault } from "../lib/vault.ts"
import { browser } from "../lib/browser.ts"
import { listProviders } from "./provider-agent.ts"

export interface Fix {
  kind: string
  ok: boolean
  detail: string
}

export async function runFixers(): Promise<Fix[]> {
  const fixes: Fix[] = []

  // 1) Remove known-broken keys from the vault.
  const pruned = removeBrokenKeys()
  fixes.push({ kind: "prune-broken-keys", ok: true, detail: `removed ${pruned.removed}` })

  // 2) Reset any stuck "needs-verify" gmail entries that have been pending >24h.
  try {
    const { listAccounts, pendingVerify } = await import("./gmail-agent.ts")
    const all = listAccounts()
    const now = Date.now()
    const stale = all.filter(
      (a) => a.status === "needs-verify" && now - Date.parse(a.created) > 24 * 3600 * 1000,
    )
    if (stale.length) {
      const { saveStore } = await import("../agents/gmail-agent.ts")
      for (const a of all) {
        if (stale.find((s) => s.email === a.email)) a.status = "failed"
      }
      saveStore(all)
      fixes.push({ kind: "reset-stale-gmails", ok: true, detail: `${stale.length} reset` })
    }
    void pendingVerify
  } catch (e) {
    fixes.push({ kind: "reset-stale-gmails", ok: false, detail: (e as Error).message })
  }

  // 3) Cap per-provider key count to a sane maximum to avoid rate-limit storms.
  try {
    const vault = loadVault()
    let touched = 0
    for (const provider of Object.keys(vault.providers)) {
      const list = vault.providers[provider]
      if (list.length > 10) {
        vault.providers[provider] = list.slice(0, 10)
        touched++
      }
    }
    if (touched) saveVault(vault)
    fixes.push({ kind: "cap-provider-keys", ok: true, detail: `${touched} providers trimmed` })
  } catch (e) {
    fixes.push({ kind: "cap-provider-keys", ok: false, detail: (e as Error).message })
  }

  // 4) Restart the browser to recover from any frozen page state.
  try {
    await browser.close()
    fixes.push({ kind: "restart-browser", ok: true, detail: "closed" })
  } catch (e) {
    fixes.push({ kind: "restart-browser", ok: false, detail: (e as Error).message })
  }

  // 5) Log provider list for diagnostic.
  fixes.push({ kind: "diagnostic", ok: true, detail: `${listProviders().length} providers loaded` })

  for (const f of fixes) log.info("fixer", `${f.kind}: ${f.ok ? "ok" : "FAIL"} — ${f.detail}`)
  return fixes
}