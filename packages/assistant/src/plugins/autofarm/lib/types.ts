// Types for the NEXUS Autonomous API Farmer
// All shared interfaces live here.

export interface GmailAccount {
  email: string
  password: string
  firstName: string
  lastName: string
  birthYear: number
  created: string
  method: "browser" | "manual" | "pending"
  status: "pending" | "active" | "blocked" | "needs-verify" | "failed"
  verifyUrl?: string // opened in user browser when captcha/phone pops up
  verifyReason?: "captcha" | "phone" | "recovery-email"
  recoveryEmail?: string // optional anonymous recovery mail
  keysGenerated: number
  verified: boolean
}

export interface FreeProvider {
  name: string // e.g. "fireworks_ai"
  label: string // "Fireworks AI"
  freeTier: true
  freePerDay: number
  url: string // dashboard / api keys page
  baseUrl: string // api base
  models: string[]
  maxKeys: number
  signupUrl: string
  // The list of field names we expect to see in the signup form.
  // Used by the provider agent to drive browser automation.
  signupFields: {
    email: string
    password: string
    name?: string
    org?: string
  }
  notes?: string
}

export interface FarmedKey {
  provider: string
  key: string
  email: string // gmail used to sign up
  createdAt: string
  status: "active" | "invalid" | "rate-limited" | "expired"
  latencyMs?: number
  validatedAt?: string
  label?: string
  source: "farm"
}

export interface DemandSignal {
  model: string
  requestedTokens: number
  requestedAt: string
  priority: "low" | "normal" | "high"
}

export interface SupplySignal {
  provider: string
  activeKeys: number
  usedToday: number
  dailyLimit: number
  ratio: number // used / limit
}

export interface SystemLoad {
  cpu: number
  memFree: number
  loadLevel: "low" | "medium" | "high"
}

export type FarmStatus =
  | "surplus" // supply > demand, stop farming
  | "balanced" // equal
  | "low" // demand > supply, farm
  | "critical" // demand >> supply, urgent farm
  | "throttled" // system load high, pause
  | "monitor" // watching only

export interface AgentReport {
  agent: string
  ok: boolean
  message: string
  data?: Record<string, unknown>
  ts: string
}

export interface VaultKeyEntry {
  key: string
  label: string
  added: string
  status: "active" | "invalid" | "rate-limited" | "expired" | "unknown"
  failures: number
  source: "auth" | "farm"
  lastChecked?: string
}

export interface VaultShape {
  providers: Record<string, VaultKeyEntry[]>
  usage: Record<string, { todayRequests: number; todayInputTokens: number; todayOutputTokens: number; lastUsed?: string }>
  usageBudget?: { version: number }
  autoRotate?: boolean
  fallbackToLocal?: boolean
}