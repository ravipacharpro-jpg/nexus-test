import { ProviderAuth } from "@/provider/auth"
import { Provider } from "@/provider/provider"

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { ProviderV2 } from "@nexus-ai/core/provider"

const root = "/provider"

const ProviderAuthErrorName = Schema.Union([
  Schema.Literal("BadRequest"),
  Schema.Literal("ProviderAuthOauthMissing"),
  Schema.Literal("ProviderAuthOauthCodeMissing"),
  Schema.Literal("ProviderAuthOauthCallbackFailed"),
  Schema.Literal("ProviderAuthValidationFailed"),
])
export class ProviderAuthApiError extends Schema.ErrorClass<ProviderAuthApiError>("ProviderAuthError")(
  {
    name: ProviderAuthErrorName,
    data: Schema.Struct({
      providerID: Schema.optional(ProviderV2.ID),
      field: Schema.optional(Schema.String),
      message: Schema.optional(Schema.String),
      kind: Schema.optional(Schema.String),
    }),
  },
  { httpApiStatus: 400 },
) {}

const ProviderVaultErrorName = Schema.Union([Schema.Literal("BadRequest"), Schema.Literal("NotFound")])
export class ProviderVaultApiError extends Schema.ErrorClass<ProviderVaultApiError>("ProviderVaultError")(
  {
    name: ProviderVaultErrorName,
    data: Schema.Struct({
      providerID: Schema.optional(Schema.String),
      message: Schema.optional(Schema.String),
    }),
  },
  { httpApiStatus: 400 },
) {}

const ApiKeyStatus = Schema.Union([
  Schema.Literal("active"),
  Schema.Literal("rate_limited"),
  Schema.Literal("invalid"),
  Schema.Literal("suspended"),
  Schema.Literal("unknown"),
])

const ProviderVaultKey = Schema.Struct({
  index: Schema.Number,
  label: Schema.String,
  key: Schema.String,
  status: ApiKeyStatus,
  failures: Schema.Number,
  added: Schema.String,
  lastChecked: Schema.optional(Schema.String),
  suspendedUntil: Schema.optional(Schema.String),
  cooldownUntil: Schema.optional(Schema.String),
  lastFailure: Schema.optional(Schema.Union([Schema.Literal("rate_limited"), Schema.Literal("invalid"), Schema.Literal("unknown")])),
  lastLatencyMs: Schema.optional(Schema.Number),
  todayRequests: Schema.Number,
  todayInputTokens: Schema.Number,
  todayOutputTokens: Schema.Number,
})

const ProviderVaultKeys = Schema.Struct({
  providers: Schema.Array(
    Schema.Struct({
      provider: Schema.String,
      keys: Schema.Array(ProviderVaultKey),
    }),
  ),
  autoRotate: Schema.Boolean,
})

const ActiveModel = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  status: ApiKeyStatus,
  logicalModels: Schema.Array(Schema.String),
})

const ActiveModels = Schema.Struct({ models: Schema.Array(ActiveModel), checkedAt: Schema.String })

const AddProviderKeyInput = Schema.Struct({
  provider: Schema.String,
  key: Schema.String,
  label: Schema.optional(Schema.String),
  metadata: Schema.optional(
    Schema.Struct({
      accountId: Schema.optional(Schema.String),
    }),
  ),
})

export const ProviderApi = HttpApi.make("provider")
  .add(
    HttpApiGroup.make("provider")
      .add(
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: described(Provider.ListResult, "List of providers"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.list",
            summary: "List providers",
            description: "Get a list of all available AI providers, including both available and connected ones.",
          }),
        ),
        HttpApiEndpoint.get("auth", `${root}/auth`, {
          query: WorkspaceRoutingQuery,
          success: described(ProviderAuth.Methods, "Provider auth methods"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.auth",
            summary: "Get provider auth methods",
            description: "Retrieve available authentication methods for all AI providers.",
          }),
        ),
        HttpApiEndpoint.get("keys", `${root}/keys`, {
          query: WorkspaceRoutingQuery,
          success: described(ProviderVaultKeys, "Masked API key status by provider"),
          error: ProviderVaultApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.keys.list",
            summary: "List provider API keys",
            description: "List masked API keys and status metadata without returning secret key material.",
          }),
        ),
        HttpApiEndpoint.post("keysAdd", `${root}/keys`, {
          query: WorkspaceRoutingQuery,
          payload: AddProviderKeyInput,
          success: described(ProviderVaultKey, "Masked provider API key entry"),
          error: ProviderVaultApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.keys.add",
            summary: "Add a provider API key",
            description: "Add a provider API key to the local rotation vault; the response is always masked.",
          }),
        ),
        HttpApiEndpoint.delete("keysRemove", `${root}/keys/:providerID/:index`, {
          params: { providerID: Schema.String, index: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(ProviderVaultKey, "Removed masked provider API key entry"),
          error: ProviderVaultApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.keys.remove",
            summary: "Remove a provider API key",
            description: "Remove a provider API key by its stable one-based index; the response is always masked.",
          }),
        ),
        HttpApiEndpoint.get("modelsActive", `${root}/models/active`, {
          query: WorkspaceRoutingQuery,
          success: described(ActiveModels, "Models available through configured API keys"),
          error: ProviderVaultApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.models.active",
            summary: "List active API models",
            description: "Discover models returned by configured providers without claiming quota or daily limits.",
          }),
        ),
        HttpApiEndpoint.post("authorize", `${root}/:providerID/oauth/authorize`, {
          params: { providerID: ProviderV2.ID },
          query: WorkspaceRoutingQuery,
          payload: ProviderAuth.AuthorizeInput,
          success: described(Schema.UndefinedOr(ProviderAuth.Authorization), "Authorization URL and method"),
          error: ProviderAuthApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.oauth.authorize",
            summary: "Start OAuth authorization",
            description: "Start the OAuth authorization flow for a provider.",
          }),
        ),
        HttpApiEndpoint.post("callback", `${root}/:providerID/oauth/callback`, {
          params: { providerID: ProviderV2.ID },
          query: WorkspaceRoutingQuery,
          payload: ProviderAuth.CallbackInput,
          success: described(Schema.Boolean, "OAuth callback processed successfully"),
          error: ProviderAuthApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.oauth.callback",
            summary: "Handle OAuth callback",
            description: "Handle the OAuth callback from a provider after user authorization.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "provider",
          description: "Experimental HttpApi provider routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "NEXUS experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )

export { ActiveModels, ActiveModel, AddProviderKeyInput, ApiKeyStatus, ProviderVaultKey, ProviderVaultKeys }
