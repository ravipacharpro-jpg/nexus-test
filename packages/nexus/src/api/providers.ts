/**
 * Single source of truth for every API vault provider.
 *
 * Adding a provider = one entry here. Validation (`checkKey`), model discovery,
 * wizard labels, offline transport fallbacks, and env-key mapping all read from
 * this registry, so a listed provider can never lack its runtime contract.
 */

export type AuthStyle = "bearer" | "x-api-key" | "query"

export interface ProviderMetadataField {
  /** Stable metadata key retained locally alongside a vault entry. */
  key: "accountId"
  /** Field label used by the CLI and Ctrl+P onboarding form. */
  label: string
  /** Short, non-secret setup guidance. */
  description: string
  /** The provider cannot make requests without this field. */
  required: boolean
}

export interface CuratedProviderModel {
  id: string
  name: string
  context: number
  output: number
  toolCall: boolean
  reasoning: boolean
  input: Array<"text" | "image">
}

export type ProviderValidation =
  | { kind: "models" }
  | { kind: "cloudflare-run"; model: string; payload: Record<string, unknown> }

export interface ProviderContract {
  /** Canonical vault/provider id used across CLI, vault, and routing. */
  id: string
  /** Human-readable label shown by the wizard and TUI. */
  label: string
  /** Convenience aliases accepted by `nexus api add` etc. */
  aliases?: string[]
  /** GET endpoint used for standard key validation and model discovery. */
  modelsEndpoint: string
  /** True when the model listing is public and therefore cannot validate a key. */
  modelsEndpointPublic?: boolean
  /** How the key is presented to the provider API. */
  auth: AuthStyle
  /** Extra static headers required alongside auth. */
  headers?: Record<string, string>
  /** OpenAI-compatible chat base URL used for request transport. */
  baseURL: string
  /** Bundled AI SDK package implementing request transport. */
  npm: string
  /** Well-known environment variable names checked for this provider. */
  env: string[]
  /** Extra non-secret fields needed for a provider-specific runtime route. */
  metadata?: ProviderMetadataField[]
  /** Validation strategy when a provider does not have a usable generic models endpoint. */
  validation?: ProviderValidation
  /** Conservative supported model metadata used when no dynamic model listing is available. */
  curatedModels?: CuratedProviderModel[]
}

export const PROVIDER_CONTRACTS: Record<string, ProviderContract> = {
  groq: {
    id: "groq",
    label: "Groq",
    modelsEndpoint: "https://api.groq.com/openai/v1/models",
    auth: "bearer",
    baseURL: "https://api.groq.com/openai/v1",
    npm: "@ai-sdk/groq",
    env: ["GROQ_API_KEY"],
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    aliases: ["or"],
    modelsEndpoint: "https://openrouter.ai/api/v1/models",
    auth: "bearer",
    baseURL: "https://openrouter.ai/api/v1",
    npm: "@openrouter/ai-sdk-provider",
    env: ["OPENROUTER_API_KEY"],
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    modelsEndpoint: "https://api.deepseek.com/models",
    auth: "bearer",
    baseURL: "https://api.deepseek.com/v1",
    npm: "@ai-sdk/openai-compatible",
    env: ["DEEPSEEK_API_KEY"],
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    aliases: ["google"],
    modelsEndpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    auth: "query",
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
    npm: "@ai-sdk/google",
    env: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
  },
  cerebras: {
    id: "cerebras",
    label: "Cerebras",
    modelsEndpoint: "https://api.cerebras.ai/v1/models",
    auth: "bearer",
    baseURL: "https://api.cerebras.ai/v1",
    npm: "@ai-sdk/cerebras",
    env: ["CEREBRAS_API_KEY"],
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    modelsEndpoint: "https://api.openai.com/v1/models",
    auth: "bearer",
    baseURL: "https://api.openai.com/v1",
    npm: "@ai-sdk/openai",
    env: ["OPENAI_API_KEY"],
  },
  opencode: {
    id: "opencode",
    label: "NEXUS Free Gateway",
    modelsEndpoint: "https://opencode.ai/zen/v1/models",
    modelsEndpointPublic: true,
    auth: "bearer",
    baseURL: "https://opencode.ai/zen/v1",
    npm: "@ai-sdk/openai-compatible",
    env: [],
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    aliases: ["claude"],
    modelsEndpoint: "https://api.anthropic.com/v1/models",
    auth: "x-api-key",
    headers: { "anthropic-version": "2023-06-01" },
    baseURL: "https://api.anthropic.com/v1",
    npm: "@ai-sdk/anthropic",
    env: ["ANTHROPIC_API_KEY"],
  },
  xai: {
    id: "xai",
    label: "xAI (Grok)",
    aliases: ["grok"],
    modelsEndpoint: "https://api.x.ai/v1/models",
    auth: "bearer",
    baseURL: "https://api.x.ai/v1",
    npm: "@ai-sdk/xai",
    env: ["XAI_API_KEY"],
  },
  mistral: {
    id: "mistral",
    label: "Mistral AI",
    modelsEndpoint: "https://api.mistral.ai/v1/models",
    auth: "bearer",
    baseURL: "https://api.mistral.ai/v1",
    npm: "@ai-sdk/mistral",
    env: ["MISTRAL_API_KEY"],
  },
  togetherai: {
    id: "togetherai",
    label: "Together AI",
    aliases: ["together"],
    modelsEndpoint: "https://api.together.xyz/v1/models",
    auth: "bearer",
    baseURL: "https://api.together.xyz/v1",
    npm: "@ai-sdk/togetherai",
    env: ["TOGETHER_API_KEY"],
  },
  perplexity: {
    id: "perplexity",
    label: "Perplexity",
    aliases: ["pplx"],
    modelsEndpoint: "https://api.perplexity.ai/router/v1/models",
    auth: "bearer",
    baseURL: "https://api.perplexity.ai/router/v1",
    npm: "@ai-sdk/perplexity",
    env: ["PERPLEXITY_API_KEY"],
  },
  cohere: {
    id: "cohere",
    label: "Cohere",
    modelsEndpoint: "https://api.cohere.com/v1/models",
    auth: "bearer",
    baseURL: "https://api.cohere.com/compatibility/v1",
    npm: "@ai-sdk/cohere",
    env: ["COHERE_API_KEY"],
  },
  fireworks: {
    id: "fireworks",
    label: "Fireworks AI",
    modelsEndpoint: "https://api.fireworks.ai/inference/v1/models",
    auth: "bearer",
    baseURL: "https://api.fireworks.ai/inference/v1",
    npm: "@ai-sdk/openai-compatible",
    env: ["FIREWORKS_API_KEY"],
  },
  moonshotai: {
    id: "moonshotai",
    label: "Moonshot AI (Kimi)",
    aliases: ["kimi", "moonshot"],
    modelsEndpoint: "https://api.moonshot.cn/v1/models",
    auth: "bearer",
    baseURL: "https://api.moonshot.cn/v1",
    npm: "@ai-sdk/openai-compatible",
    env: ["MOONSHOT_API_KEY"],
  },
  "cloudflare-workers-ai": {
    id: "cloudflare-workers-ai",
    label: "Cloudflare Workers AI",
    aliases: ["cloudflare", "workers-ai"],
    // Workers AI does not expose a generic account-scoped OpenAI /models route.
    // Validation uses the documented account-scoped Run endpoint below instead.
    modelsEndpoint: "https://api.cloudflare.com/client/v4",
    auth: "bearer",
    baseURL: "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1",
    npm: "@ai-sdk/openai-compatible",
    env: ["CLOUDFLARE_API_KEY"],
    metadata: [
      {
        key: "accountId",
        label: "Cloudflare Account ID",
        description: "Find it on the Cloudflare Workers AI page. It is required with the scoped API token.",
        required: true,
      },
    ],
    validation: {
      kind: "cloudflare-run",
      model: "@cf/meta/llama-3.1-8b-instruct",
      payload: {
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: 1,
      },
    },
    curatedModels: [
      {
        id: "@cf/meta/llama-3.1-8b-instruct",
        name: "Llama 3.1 8B Instruct",
        context: 128000,
        output: 8192,
        toolCall: false,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "@cf/qwen/qwen2.5-coder-32b-instruct",
        name: "Qwen 2.5 Coder 32B Instruct",
        context: 32768,
        output: 8192,
        toolCall: false,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "@cf/meta/llama-3.2-11b-vision-instruct",
        name: "Llama 3.2 11B Vision Instruct",
        context: 128000,
        output: 8192,
        toolCall: false,
        reasoning: false,
        input: ["text", "image"],
      },
      {
        id: "@cf/qwen/qwq-32b",
        name: "QwQ 32B",
        context: 32768,
        output: 8192,
        toolCall: false,
        reasoning: true,
        input: ["text"],
      },
    ],
  },
  "nvidia-nim": {
    id: "nvidia-nim",
    label: "NVIDIA NIM",
    aliases: ["nvidia-api", "nim"],
    // Hosted NVIDIA API Catalog inference only. This must not be confused with
    // a user-operated local NIM container or imply any local GPU requirement.
    modelsEndpoint: "https://integrate.api.nvidia.com/v1/models",
    auth: "bearer",
    baseURL: "https://integrate.api.nvidia.com/v1",
    npm: "@ai-sdk/openai-compatible",
    env: ["NVIDIA_NIM_API_KEY"],
    curatedModels: [
      {
        id: "meta/llama-3.3-70b-instruct",
        name: "Llama 3.3 70B Instruct",
        context: 131072,
        output: 8192,
        toolCall: false,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "qwen/qwen2.5-coder-32b-instruct",
        name: "Qwen 2.5 Coder 32B Instruct",
        context: 32768,
        output: 8192,
        toolCall: false,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "nvidia/nemotron-3.5-lightning-30b-a3b",
        name: "Nemotron 3.5 Lightning 30B",
        context: 32768,
        output: 8192,
        toolCall: false,
        reasoning: false,
        input: ["text"],
      },
      {
        id: "qwen/qwen3-next-80b-a3b-thinking",
        name: "Qwen3 Next 80B Thinking",
        context: 32768,
        output: 8192,
        toolCall: false,
        reasoning: true,
        input: ["text"],
      },
    ],
  },
}

export const REGISTRY_PROVIDER_IDS = Object.keys(PROVIDER_CONTRACTS)

/** Resolve an id or alias to its canonical contract. */
export function contractFor(input: string): ProviderContract | undefined {
  const raw = input.trim().toLowerCase().replace(/[\s_]+/g, "-")
  const direct = PROVIDER_CONTRACTS[raw]
  if (direct) return direct
  return Object.values(PROVIDER_CONTRACTS).find((contract) => contract.aliases?.includes(raw))
}
