import { Auth } from "@/auth"

import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { LogInput } from "../groups/control"
import { ProviderV2 } from "@nexus-ai/core/provider"
import { addApiKey, removeManagedApiKey } from "@/api/ApiVault"

export const controlHandlers = HttpApiBuilder.group(RootHttpApi, "control", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service

    const authSet = Effect.fn("ControlHttpApi.authSet")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: Auth.Info
    }) {
      yield* auth.set(ctx.params.providerID, ctx.payload).pipe(Effect.orDie)
      if (ctx.payload.type === "api") {
        try {
          addApiKey(ctx.params.providerID, ctx.payload.key, "ui", "ui")
        } catch {
          // Providers outside ApiVault continue to use the regular Auth store.
        }
      }
      return true
    })

    const authRemove = Effect.fn("ControlHttpApi.authRemove")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
    }) {
      const current = yield* auth.get(ctx.params.providerID).pipe(Effect.orElseSucceed(() => undefined))
      yield* auth.remove(ctx.params.providerID).pipe(Effect.orDie)
      if (current?.type === "api") removeManagedApiKey(ctx.params.providerID, current.key)
      return true
    })

    const log = Effect.fn("ControlHttpApi.log")(function* (ctx: { payload: typeof LogInput.Type }) {
      const write =
        ctx.payload.level === "debug"
          ? Effect.logDebug
          : ctx.payload.level === "info"
            ? Effect.logInfo
            : ctx.payload.level === "warn"
              ? Effect.logWarning
              : Effect.logError
      yield* write(ctx.payload.message).pipe(Effect.annotateLogs(ctx.payload.extra ?? {}))
      return true
    })

    return handlers.handle("authSet", authSet).handle("authRemove", authRemove).handle("log", log)
  }),
)
