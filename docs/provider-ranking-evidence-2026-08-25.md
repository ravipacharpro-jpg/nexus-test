# Add API Provider Ranking Evidence — 2026-08-25

This evidence supports qualitative Ctrl+P provider ranking only. It must not be interpreted as a user account balance, a guaranteed model entitlement, a live quota reading, or a fixed token promise.

## Official sources reviewed

Cloudflare Workers AI publishes a universal free allocation of **10,000 Neurons per day**, resetting at 00:00 UTC. Its pricing page also states that some models require a paid billing method, so the UI must retain an account/model condition notice rather than promise each listed model is free. [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), last updated 2026-08-18.

Groq publishes a **Free Plan Limits** table with model-specific RPM, RPD, TPM, and TPD limits. The exact limits are organization-level, can have exceptions, and the provider directs users to their account limits page for the current values. The UI can classify Groq as verified recurring free access with a model/account condition badge, but must not show a fixed cross-model token amount. [Groq rate limits](https://console.groq.com/docs/rate-limits).

Google documents a **Free** Gemini API tier for an active project or free trial. It states limits are project-level, model- and tier-dependent, may vary, and must be viewed in AI Studio. The UI can classify Gemini as verified recurring free access with a project/model condition badge, but must not claim a fixed daily token quota. [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), last updated 2026-08-18.

OpenRouter documents free-model limits of 20 RPM and 50 RPD for accounts with fewer than $10 all-time credits, and 1,000 RPD after the threshold. It also explains account credit status and upstream availability affect access. The UI must classify it as conditional free models rather than a universal recurring free allocation. [OpenRouter API limits](https://openrouter.ai/docs/api_reference/limits).

## Resulting qualitative order

1. **Verified recurring free with broad documented access:** Cloudflare Workers AI, Groq, Gemini.
2. **Conditional free-model access:** OpenRouter.
3. **Account/model-specific access:** NVIDIA NIM.
4. **Paid, trial, or unverified recurring allocation:** remaining providers, alphabetical after the existing capability/contract order.
5. **Custom endpoint:** always last.

### No fixed quota figures policy

The picker deliberately shows only qualitative, account-agnostic category order and condition badges. Even officially published figures (Cloudflare Workers AI's daily Neuron allocation, OpenRouter's request-per-day thresholds) stay out of visible copy and out of ordering logic: a number next to a provider can read as an account balance, entitlement, or live quota promise, which the ranking must never imply.

The application must retain manual provider choice and must not contact a provider, inspect a key, estimate balance, or alter routing merely to display this ranking.
