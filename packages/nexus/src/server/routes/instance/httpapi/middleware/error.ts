import { NamedError } from "@nexus-ai/core/util/error"
import { ConfigErrorV1 } from "@nexus-ai/core/v1/config/error"
import { Cause, Effect } from "effect"
import { HttpRouter, HttpServerError, HttpServerRespondable, HttpServerResponse } from "effect/unstable/http"

function safeServerMessage(cause: Cause.Cause<unknown>): string {
  const text = Cause.pretty(cause)
  if (/no api key|missing.*(?:api key|credential)|credential.*missing|authentication.*missing/i.test(text)) {
    return "No API key is configured for the selected provider. Configure a provider key and retry."
  }
  if (/invalid.*api key|api key.*(?:invalid|not valid)|unauthorized|forbidden|\b(?:401|403)\b/i.test(text)) {
    return "Provider authentication failed. Check the selected provider key and retry."
  }
  if (/model.*(?:not found|does not exist|unsupported)|unsupported.*model|\b404\b/i.test(text)) {
    return "The selected model is unavailable for this provider. Run `nexus models` and choose a supported text model."
  }
  if (/getaddrinfo|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|network|transport/i.test(text)) {
    return "The provider request could not reach the network. Check DNS or connectivity and retry."
  }
  return "Unexpected server error. Check server logs for details."
}

// Keep typed HttpApi failures on their declared error path; this boundary only replaces defect-only empty 500s.
export const errorLayer = HttpRouter.middleware<{ handles: unknown }>()((effect) =>
  effect.pipe(
    Effect.catchCause((cause) => {
      const defect = cause.reasons.filter(Cause.isDieReason).find((reason) => {
        if (HttpServerResponse.isHttpServerResponse(reason.defect)) return false
        if (HttpServerError.isHttpServerError(reason.defect)) return false
        if (HttpServerRespondable.isRespondable(reason.defect)) return false
        return true
      })
      if (!defect) return Effect.failCause(cause)

      const error = defect.defect
      if (
        ConfigErrorV1.JsonError.isInstance(error) ||
        ConfigErrorV1.InvalidError.isInstance(error) ||
        ConfigErrorV1.FrontmatterError.isInstance(error) ||
        ConfigErrorV1.DirectoryTypoError.isInstance(error)
      ) {
        return Effect.succeed(HttpServerResponse.jsonUnsafe(error.toObject(), { status: 400 }))
      }

      const ref = `err_${crypto.randomUUID().slice(0, 8)}`

      return Effect.logError("failed", { ref, error, cause: Cause.pretty(cause) }).pipe(
        Effect.as(
          HttpServerResponse.jsonUnsafe(
            new NamedError.Unknown({
              message: safeServerMessage(cause),
              ref,
            }).toObject(),
            { status: 500 },
          ),
        ),
      )
    }),
  ),
).layer
