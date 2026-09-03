# Auto Model and API Vault Policy

## Purpose

NEXUS exposes **Auto Model** as the default selection mode. It is a policy mode, not a fictional provider or a stored API key. Manual provider/model selection always remains available and takes precedence for the current session.

## Eligibility and selection

For every request, Auto Model considers only a model whose provider is configured and whose usable key set contains at least one key that is not `invalid` and not currently `suspended`. A candidate must satisfy the request contract: tool calls require `tool_call`, image input requires attachment/image support, and large output requests require a sufficient advertised output limit. The selection record must include the concrete model, provider, and reason so the user can inspect the decision.

Selection is deterministic. NEXUS first prefers a healthy configured model satisfying all hard requirements, then a compatible provider/model fallback, and finally an explicitly enabled local model. It must never silently select a model that lacks a required capability. If no candidate is compatible, the request fails with an actionable explanation rather than pretending that an unsupported model can execute it.

## Key health and rotation

Multiple different keys for the same provider are supported. Rotation may use them one at a time; a `rate_limited` key is retained for later retry, while an `invalid` key is excluded immediately. Repeated rate-limit or validation failures can temporarily suspend a key according to the existing vault policy. Keys are not deleted automatically; the UI exposes their masked status and lets the user retry validation or remove a key deliberately.

Exact duplicate key material is deduplicated within a provider vault entry. NEXUS must not claim that two different keys belong to the same upstream account unless that provider offers an authorized account identity endpoint and the user has opted into that check. Different keys therefore remain separate rotation entries by default.

## Ctrl+P onboarding

The Ctrl+P **Add API key** command presents all providers backed by a complete runtime contract, then offers a separate **Custom OpenAI-compatible provider** flow. Every key is entered in a password field, stored in the local vault with private file permissions, and displayed only in masked form. The custom flow requires a user-chosen label and HTTPS base URL; it validates an endpoint and model list before the provider becomes Auto Model eligible.

API validation is explicit after save and is repeatable. A connectivity failure is reported as `unknown`, not mislabeled as an invalid credential. A confirmed 400, 401, or 403 validation response marks the key invalid and removes it from automatic routing, while preserving the masked entry for inspection.

## Non-goals

This policy does not estimate paid balances, infer an external account owner from an API key, merge distinct credentials, expose secrets in UI state or logs, or promise that a provider's model list means every model has available quota.
