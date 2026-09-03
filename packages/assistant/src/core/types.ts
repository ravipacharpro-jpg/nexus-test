export type EnvironmentType = "termux" | "low-end-pc" | "pc"

export interface EnvironmentConfig {
  type: EnvironmentType
  maxPlugins: number
  idleTimeoutMs: number
  preferCloudAI: boolean
  disabledPlugins: string[]
  parallelJobs: number
  tempDir: string
}

export interface UserIntent {
  plugin: string
  command: string
  args: string[]
  confidence: number
  query: string
}

export interface HitlRequest {
  title: string
  detail?: string
  danger?: boolean
}

export interface LlmClient {
  generate(prompt: string, images?: string[]): Promise<string>
}

export interface PluginContext {
  cwd: string
  env: EnvironmentConfig
  args: string[]
  flags: Record<string, unknown>
  confirm(request: HitlRequest): Promise<boolean>
  out(message: string): void
  err(message: string): void
  llm?: LlmClient
}

export interface PluginCommand {
  name: string
  describe: string
  usage?: string
  run(ctx: PluginContext): Promise<number | void>
}

export interface NexusPlugin {
  name: string
  version: string
  description: string
  tags: string[]
  requires?: {
    platform?: NodeJS.Platform[]
    check?(): { ok: boolean; reason?: string }
  }
  commands: PluginCommand[]
}

export * as Types from "./types"
