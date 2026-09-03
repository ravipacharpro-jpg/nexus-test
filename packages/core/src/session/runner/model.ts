export * as SessionRunnerModel from "./model"

import { makeLocationNode } from "../../effect/app-node"
import { type Model } from "@nexus-ai/llm"
import * as AnthropicMessages from "@nexus-ai/llm/protocols/anthropic-messages"
import * as OpenAICompatibleChat from "@nexus-ai/llm/protocols/openai-compatible-chat"
import * as OpenAIResponses from "@nexus-ai/llm/protocols/openai-responses"
import * as OpenAIChat from "@nexus-ai/llm/protocols/openai-chat"
import * as Gemini from "@nexus-ai/llm/protocols/gemini"
import * as BedrockConverse from "@nexus-ai/llm/protocols/bedrock-converse"
import { Auth, type AnyRoute } from "@nexus-ai/llm/route"
import { Context, Effect, Layer, Schema } from "effect"
import { produce } from "immer"
import { Catalog } from "../../catalog"
import { Config } from "../../config"
import { getDeviceConfig } from "../../device"
import { Credential } from "../../credential"
import { Integration } from "../../integration"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"
import { SessionSchema } from "../schema"

export class ModelNotSelectedError extends Schema.TaggedErrorClass<ModelNotSelectedError>()(
  "SessionRunnerModel.ModelNotSelectedError",
  {
    sessionID: SessionSchema.ID,
  },
) {
  override get message() {
    return `No model is available for session ${this.sessionID}`
  }
}

export class ModelUnavailableError extends Schema.TaggedErrorClass<ModelUnavailableError>()(
  "SessionRunnerModel.ModelUnavailableError",
  {
    providerID: ProviderV2.ID,
    modelID: ModelV2.ID,
  },
) {
  override get message() {
    return `Model unavailable: ${this.providerID}/${this.modelID}`
  }
}

export class VariantUnavailableError extends Schema.TaggedErrorClass<VariantUnavailableError>()(
  "SessionRunnerModel.VariantUnavailableError",
  {
    providerID: ProviderV2.ID,
    modelID: ModelV2.ID,
    variant: ModelV2.VariantID,
  },
) {
  override get message() {
    return `Variant unavailable for ${this.providerID}/${this.modelID}: ${this.variant}`
  }
}

export class UnsupportedApiError extends Schema.TaggedErrorClass<UnsupportedApiError>()(
  "SessionRunnerModel.UnsupportedApiError",
  {
    providerID: ProviderV2.ID,
    modelID: ModelV2.ID,
    api: Schema.String,
  },
) {
  override get message() {
    return `Unsupported API for ${this.providerID}/${this.modelID}: ${this.api}`
  }
}

export type Error =
  | ModelNotSelectedError
  | ModelUnavailableError
  | VariantUnavailableError
  | UnsupportedApiError
  | Integration.AuthorizationError

export interface Interface {
  readonly resolve: (session: SessionSchema.Info) => Effect.Effect<Model, Error>
}

export class Service extends Context.Service<Service, Interface>()("@nexus/v2/SessionRunnerModel") {}

/** Test or embedding seam for supplying a model resolver directly. */
export const layerWith = (resolve: Interface["resolve"]) => Layer.succeed(Service, Service.of({ resolve }))

const apiKey = (model: ModelV2.Info, credential?: Credential.Value) => {
  if (credential?.type === "key") return Auth.value(credential.key)
  if (credential?.type === "oauth") return Auth.value(credential.access)
  const value = model.request.body.apiKey ?? model.api.settings?.apiKey
  if (typeof value === "string") return Auth.value(value)
}

const withDefaults = (model: ModelV2.Info, route: AnyRoute) => {
  const body = model.request.body
  const httpBody = Object.hasOwn(body, "apiKey")
    ? Object.fromEntries(Object.entries(body).filter(([key]) => key !== "apiKey"))
    : body
  return route.with({
    provider: model.providerID,
    endpoint: model.api.url === undefined ? undefined : { baseURL: model.api.url },
    headers: model.request.headers,
    http: { body: httpBody },
    limits: { context: model.limit.context, output: model.limit.output },
  })
}

const withVariant = (
  model: ModelV2.Info,
  variantID: ModelV2.VariantID | undefined,
): Effect.Effect<ModelV2.Info, VariantUnavailableError> => {
  const id = variantID === "default" || variantID === undefined ? model.request.variant : variantID
  const variant = model.variants.find((item) => item.id === id)
  if (!variant && variantID !== undefined && variantID !== "default")
    return Effect.fail(
      new VariantUnavailableError({
        providerID: model.providerID,
        modelID: model.id,
        variant: variantID,
      }),
    )
  return Effect.succeed(
    variant
      ? produce(model, (draft) => {
          Object.assign(draft.request.headers, variant.headers)
          Object.assign(draft.request.body, variant.body)
        })
      : model,
  )
}

const apiName = (model: ModelV2.Info) =>
  model.api.type === "aisdk" ? `${model.api.type}:${model.api.package}` : model.api.type

export const fromCatalogModel = (
  model: ModelV2.Info,
  credential?: Credential.Value,
): Effect.Effect<Model, UnsupportedApiError> => {
  const resolved =
    credential?.type !== "key" || credential.metadata === undefined
      ? model
      : produce(model, (draft) => {
          Object.assign(draft.request.body, credential.metadata)
        })
  const key = apiKey(resolved, credential)
  if (resolved.api.type === "aisdk" && resolved.api.package === "@ai-sdk/openai") {
    const chatOnly = /^(gpt-3|gpt-4-\d|gpt-4$|o1-mini)/.test(resolved.api.id)
    const route = chatOnly ? OpenAIChat.route : OpenAIResponses.route
    return Effect.succeed(
      withDefaults(resolved, route)
        .with({ auth: key === undefined ? Auth.none : Auth.bearer(key) })
        .model({ id: resolved.api.id }),
    )
  }
  if (resolved.api.type === "aisdk" && resolved.api.package === "@ai-sdk/anthropic") {
    return Effect.succeed(
      withDefaults(resolved, AnthropicMessages.route)
        .with({ auth: key === undefined ? Auth.none : Auth.header("x-api-key", key) })
        .model({ id: resolved.api.id }),
    )
  }
  if (resolved.api.type === "aisdk" && resolved.api.package === "@ai-sdk/google") {
    return Effect.succeed(
      withDefaults(resolved, Gemini.route)
        .with({ auth: key === undefined ? Auth.none : Auth.header("x-goog-api-key", key) })
        .model({ id: resolved.api.id }),
    )
  }
  if (resolved.api.type === "aisdk" && resolved.api.package === "@ai-sdk/amazon-bedrock") {
    return Effect.succeed(
      withDefaults(resolved, BedrockConverse.route)
        .with({ auth: Auth.none }) // Auth handled by AWS SDK internally in runner if needed, or via bearer if proxy
        .model({ id: resolved.api.id }),
    )
  }
  if (
    resolved.api.type === "aisdk" &&
    (resolved.api.package === "@ai-sdk/openai-compatible" ||
      resolved.api.package === "@openrouter/ai-sdk-provider" ||
      resolved.api.package === "@xai/ai-sdk-provider" ||
      resolved.api.package === "xai-ai-sdk-provider" ||
      resolved.api.package === "groq-ai-sdk-provider" ||
      resolved.api.package === "@groq/ai-sdk-provider" ||
      resolved.api.package === "mistral-ai-sdk-provider" ||
      resolved.api.package === "@mistral/ai-sdk-provider")
  ) {
    return Effect.succeed(
      withDefaults(resolved, OpenAICompatibleChat.route)
        .with({ auth: key === undefined ? Auth.none : Auth.bearer(key) })
        .model({ id: resolved.api.id }),
    )
  }
  return Effect.fail(
    new UnsupportedApiError({
      providerID: resolved.providerID,
      modelID: resolved.id,
      api: apiName(resolved),
    }),
  )
}

export const resolve = (session: SessionSchema.Info, model: ModelV2.Info, credential?: Credential.Value) =>
  withVariant(model, session.model?.variant).pipe(Effect.flatMap((model) => fromCatalogModel(model, credential)))

export const supported = (model: ModelV2.Info) =>
  model.api.type === "aisdk" &&
  (model.api.package === "@ai-sdk/openai" ||
    model.api.package === "@ai-sdk/anthropic" ||
    (model.api.package === "@ai-sdk/openai-compatible" && model.api.url !== undefined))

/** Resolves models from the catalog belonging to the current Location runtime. */
export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const integrations = yield* Integration.Service
    const config = yield* Config.Service
    return Service.of({
      resolve: Effect.fn("SessionRunnerModel.resolve")(function* (session) {
        // Location plugins populate and filter the catalog asynchronously during layer startup.
        const available = yield* catalog.model.available()
        const entries = yield* config.entries()
        const configuredModel = Config.latest(entries, "model")
        const deviceModel = getDeviceConfig({
          maxConcurrentTools: Config.latest(entries, "max_concurrent_tools"),
        }).preferredModel
        const automaticModel = configuredModel ?? deviceModel
        const automaticRef = automaticModel?.includes("/")
          ? (() => {
              const [providerID, ...modelParts] = automaticModel.split("/")
              const modelID = modelParts.join("/")
              return providerID && modelID ? { providerID, modelID } : undefined
            })()
          : undefined
        const configured = automaticRef
          ? available.find((model) => model.providerID === automaticRef.providerID && model.id === automaticRef.modelID)
          : undefined
        const defaultModel = session.model ? undefined : (configured ?? (yield* catalog.model.default()))
        const selected = session.model
          ? available.find((model) => model.providerID === session.model?.providerID && model.id === session.model.id)
          : defaultModel && supported(defaultModel)
            ? defaultModel
            : available.find(supported)
        if (!selected && session.model)
          return yield* new ModelUnavailableError({
            providerID: session.model.providerID,
            modelID: session.model.id,
          })
        if (!selected) return yield* new ModelNotSelectedError({ sessionID: session.id })
        const provider = yield* catalog.provider.get(selected.providerID)
        const connection = yield* integrations.connection.active(
          provider?.integrationID ?? Integration.ID.make(selected.providerID),
        )
        return yield* resolve(
          session,
          selected,
          connection ? yield* integrations.connection.resolve(connection) : undefined,
        )
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer: locationLayer, deps: [Catalog.node, Integration.node, Config.node] })
