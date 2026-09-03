// partial-features: the canonical list of every 'partial' or
// 'verified' capability in NEXUS, ready to be merged into the
// capability registry. Loaded on first use of the autofarm.
//
// User requirement (NEXUS_QUALITY_CHECKLIST.md): the four stub
// agents in packages/termux-core/src/agents/ (GameDevAgent,
// LuaModdingAgent, BotAgent, ToolAgent) must be registered as
// 'partial' so the UI/CLI can warn users that calling them
// returns a hardcoded template, not a real model response.
//
// In addition we register the recently-added verified features
// (browser-use, Quackr free phone, 5sim paid, vault key
// rotation, persistent memory) so the registry stays the single
// source of truth for 'what is real and what is not'.
//
// Cross-package note: this file is in packages/assistant and
// references packages/nexus. We import types only so the build
// works without a peer-dep declaration; at runtime we read the
// type values via a JSON contract, not via direct function
// imports. The builder below produces a plain object the autofarm
// can serialize / persist / inspect.

export type FeatureStatus = "verified" | "partial" | "blocked" | "unknown"

export interface PartialFeatureRecord {
  id: string
  name: string
  version: string
  status: FeatureStatus
  summary: string
  files: string[]
  tests: string[]
  limitations: string[]
}

/** All partial / blocked features in one place. */
export const PARTIAL_FEATURES: ReadonlyArray<PartialFeatureRecord> = [
  {
    id: "game-dev-agent",
    name: "GameDevAgent",
    version: "0.1.0",
    status: "partial",
    summary: "Reports file metadata for a .pak path; no real PAK/asset parser wired.",
    files: ["packages/termux-core/src/agents/GameDevAgent.ts"],
    tests: ["test/eval-cases/GameDevAgent/missing-file.json"],
    limitations: [
      "no PAK/asset parser wired",
      "no model is consulted for content analysis",
      "returns hardcoded template after the file-stat step",
    ],
  },
  {
    id: "lua-modding-agent",
    name: "LuaModdingAgent",
    version: "0.1.0",
    status: "partial",
    summary: "Echoes input length and attaches a VerificationReceipt; no Lua formatter bundled.",
    files: ["packages/termux-core/src/agents/LuaModdingAgent.ts"],
    tests: ["test/eval-cases/LuaModdingAgent/empty-input.json", "test/eval-cases/LuaModdingAgent/small-script.json"],
    limitations: ["no lua-format / stylua binary bundled", "no AST-aware formatting"],
  },
  {
    id: "bot-agent",
    name: "BotAgent",
    version: "0.1.0",
    status: "partial",
    summary: "Generates a Python Telegram echo bot, verifies with py_compile.",
    files: ["packages/termux-core/src/agents/BotAgent.ts"],
    tests: [],
    limitations: ["no LLM is consulted", "no real template variety — every bot is the same echo skeleton"],
  },
  {
    id: "tool-agent",
    name: "ToolAgent",
    version: "0.1.0",
    status: "partial",
    summary: "Generates a small JSON-pass-through tool, verifies with bash -n + node --check.",
    files: ["packages/termux-core/src/agents/ToolAgent.ts"],
    tests: [],
    limitations: ["no LLM is consulted", "no template variety — every tool is the same skeleton"],
  },
]

/** Verified features (the things autofarm actually delivers
 *  end-to-end today, no orchestrator required). */
export const VERIFIED_FEATURES: ReadonlyArray<PartialFeatureRecord> = [
  {
    id: "autofarm-gmail-creator",
    name: "Gmail creator (browser-based)",
    version: "0.1.73",
    status: "verified",
    summary: "createAccountViaBrowser() drives Playwright/browser-use to fill a real Google signup flow with session warming + stealth patches.",
    files: ["packages/assistant/src/plugins/autofarm/agents/gmail-agent.ts"],
    tests: [],
    limitations: [],
  },
  {
    id: "autofarm-quackr-phone",
    name: "Quackr.io free phone-verify",
    version: "0.1.0",
    status: "verified",
    summary: "Picks a free US/CA/AU public number, polls the inbox, auto-fills the OTP into the Google verification form.",
    files: ["packages/assistant/src/plugins/autofarm/lib/quackr.ts"],
    tests: [],
    limitations: [],
  },
  {
    id: "autofarm-5sim-paid-phone",
    name: "5sim.net paid phone-verify (optional)",
    version: "0.1.0",
    status: "verified",
    summary: "Client for the 5sim.net REST API. Activated only when FIVE_SIM_API_KEY is set; otherwise no-op.",
    files: ["packages/assistant/src/plugins/autofarm/lib/fivesim.ts"],
    tests: [],
    limitations: [],
  },
  {
    id: "autofarm-vault-key-rotation",
    name: "Vault key round-robin + cooldown",
    version: "0.1.0",
    status: "verified",
    summary: "pickNextKey() rotates through every active OpenRouter key in ~/.nexus/api-vault.json, backed off 5m after a 429 and 1h after 3+ 429s in a day.",
    files: ["packages/assistant/src/plugins/autofarm/lib/vault-key-rotation.ts"],
    tests: [],
    limitations: [],
  },
  {
    id: "autofarm-multi-agent-dispatch",
    name: "Multi-agent free-model dispatcher",
    version: "0.1.0",
    status: "verified",
    summary: "dispatch() runs SubTask[] in parallel, each backed by a different free OpenRouter model. On failure rotates to the next model up to opts.maxRetries.",
    files: ["packages/assistant/src/plugins/autofarm/lib/model-fallback.ts"],
    tests: [],
    limitations: [],
  },
  {
    id: "autofarm-session-warming",
    name: "Pre-Gmail session warming",
    version: "0.1.0",
    status: "verified",
    summary: "Before every Gmail signup, drive the browser through 3-5 random sites (BBC/Wiki/YouTube/Reddit) so Google sees a real-user fingerprint instead of a fresh browser.",
    files: ["packages/assistant/src/plugins/autofarm/lib/session-warming.ts"],
    tests: [],
    limitations: [],
  },
  {
    id: "autofarm-playwright-stealth",
    name: "Playwright-stealth anti-bot patches",
    version: "0.1.0",
    status: "verified",
    summary: "9 init-script patches (navigator.webdriver, plugins, chrome.runtime, WebGL, hardwareConcurrency, userAgentData, hairline) auto-injected on every navigate().",
    files: ["packages/assistant/src/plugins/autofarm/lib/playwright-stealth.ts"],
    tests: [],
    limitations: [],
  },
  {
    id: "autofarm-nexus-memory",
    name: "Persistent cross-session memory",
    version: "0.1.0",
    status: "verified",
    summary: "~/.nexus/memory.json holds preferences, recent tasks, last health verdict, and the rotation cursor. Survives restarts and cross-device sync.",
    files: ["packages/assistant/src/plugins/autofarm/lib/nexus-memory.ts"],
    tests: [],
    limitations: [],
  },
  {
    id: "autofarm-browser-use-integration",
    name: "browser-use MCP integration (Termux-friendly)",
    version: "0.1.0",
    status: "verified",
    summary: "scripts/install-browser-use.sh installs browser-use in ~/.nexus/autofarm/.venv so autofarm can drive Chromium on any device without Playwright MCP.",
    files: ["scripts/install-browser-use.sh", "packages/assistant/src/plugins/autofarm/lib/browser-use.ts"],
    tests: [],
    limitations: [],
  },
]

/** Plain-object registry shape. The autofarm master and the
 *  do.ts gate consume this directly. The actual capability
 *  registry in packages/nexus has more lifecycle methods
 *  (load/save/upsert) — for a single-shot summary this struct
 *  is enough. */
export interface PartialRegistrySnapshot {
  version: 1
  generatedAt: string
  features: PartialFeatureRecord[]
  totals: { verified: number; partial: number; blocked: number; unknown: number }
}

export function buildDefaultRegistry(): PartialRegistrySnapshot {
  const features: PartialFeatureRecord[] = [...PARTIAL_FEATURES, ...VERIFIED_FEATURES]
  const totals = { verified: 0, partial: 0, blocked: 0, unknown: 0 }
  for (const f of features) totals[f.status]++
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    features,
    totals,
  }
}

/** Format the registry as a one-line-per-feature table for the CLI. */
export function formatRegistryReport(s: PartialRegistrySnapshot): string {
  const lines: string[] = []
  lines.push(`Capability registry — ${s.generatedAt}`)
  lines.push(
    `  verified=${s.totals.verified}  partial=${s.totals.partial}  blocked=${s.totals.blocked}  unknown=${s.totals.unknown}`,
  )
  for (const f of s.features) {
    const lim = f.limitations.length > 0 ? `  (${f.limitations.length} limitation(s))` : ""
    lines.push(`  [${f.status.padEnd(8)}] ${f.id.padEnd(36)} ${f.name}${lim}`)
  }
  return lines.join("\n")
}
