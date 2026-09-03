# Cloudflare Workers AI Provider Readiness Assessment

## Official Findings Captured

Cloudflare documents an OpenAI-compatible Workers AI API under an account-scoped base URL, using an API token in the `Authorization: Bearer` header. The documented compatibility surface includes text chat completions and embeddings; compatibility must therefore be checked model-by-model rather than inferred from an OpenAI-compatible URL alone.[1]

Cloudflare documents a shared allocation of **10,000 Neurons per day** and daily reset at 00:00 UTC. The documentation also states that some models require a paid billing method and that usage above the allocation requires Workers Paid billing. NEXUS must treat this only as a public policy fact: it must not expose it as a user's remaining balance, guaranteed model availability, or account eligibility.[2]

Cloudflare presents a changing Workers AI model catalog with task types and capability labels. The catalog is not a durable NEXUS capability contract: an onboarding flow should validate the selected account/model explicitly and retain only confirmed capability metadata. The public limits page also notes that beta models may have lower limits, so NEXUS must preserve existing cooldown/retry behavior rather than promise a universal Workers AI rate limit.[3] [4]

## Implication for NEXUS

Any future provider onboarding must request an account ID and narrowly scoped token through existing masked vault handling, validate only through an explicit user action, and retain unknown/failed validation states truthfully. Auto Model should receive capability metadata only after a successful provider/model validation; manual selection must remain first.

## Existing NEXUS Contract Assessment

The current NEXUS provider registry already contains a dedicated `cloudflare-workers-ai` contract rather than an unverified label-only entry. Its request base is account-scoped, it declares an `accountId` metadata requirement, uses bearer authentication, and applies a provider-specific minimal Run validation because Cloudflare does not expose a generic account-scoped OpenAI-compatible `/models` endpoint in this flow. The existing catalog is conservative: text, vision, and reasoning entries are explicit and tool calling is not advertised for those curated entries.

This is compatible with the official OpenAI-compatible chat route, but it does **not** prove that every account can use every curated model. The implementation must continue to treat successful explicit validation as the eligibility boundary, retain manual selection, and map temporary failures to unknown/retryable instead of invalidating a token blindly.

| Readiness area | Assessment | Required behavior |
|---|---|---|
| Request transport | Ready for the official account-scoped OpenAI-compatible base URL. | Substitute only the user-supplied account ID at dispatch time; never print it with the API token. |
| Credential storage | Ready through the existing masked local API vault and provider metadata field. | Request a scoped token/account ID only in the existing private onboarding path; do not accept raw credentials in task text. |
| Validation | Ready through a minimal documented-provider Run request. | Make validation explicit; retain `unknown` for connectivity/rate/billing ambiguity and reserve invalid for confirmed authentication failure. |
| Model capability | Conservative local curated metadata exists. | Do not imply an account-wide model list or guaranteed availability; filter Auto candidates only after validation. |
| Usage communication | Public policy only. | State the qualified 10,000 Neurons/day policy, but never show it as an account balance, remaining quota, or cost guarantee. |

## Recommended Controlled Test Gate

Before calling the contract broadly available, run a user-authorized test with a newly added masked token and account ID. The test should verify an explicit key check, one minimal text request, masked listing, a manual model selection, and a deliberate invalid/temporary-failure classification. It should not attempt to infer billing status, consume bulk workload, add a browser login, or enable automatic fallback outside existing safe-point and local-cap rules.

The implementation recommendation is therefore **controlled availability**, not a new provider rewrite: retain the existing contract, keep its curated model metadata conservative, and allow the existing Ctrl+P/CLI onboarding only once its current validation path remains covered by focused runtime tests.

## References

[1] [Cloudflare Workers AI: OpenAI compatible API endpoints](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)

[2] [Cloudflare Workers AI: Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)

[3] [Cloudflare Workers AI: Models](https://developers.cloudflare.com/workers-ai/models/)

[4] [Cloudflare Workers AI: Limits](https://developers.cloudflare.com/workers-ai/platform/limits/)
