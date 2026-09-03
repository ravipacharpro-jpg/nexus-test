# NEXUS-FIXED Audit Baseline

## Current architecture

The repository is a Bun/TypeScript monorepo. The terminal path is implemented mainly under `packages/nexus/src/cli/cmd/run`, with a split-footer TUI, a serial prompt queue, an event-stream transport, a session-data reducer, permission/question views, and existing shell/file/Git/web-fetch/web-search/task/todo tools. The queue already submits ordinary prompts with `session.promptAsync`, so the UI can remain responsive while the stream transport waits for completion.

Provider support is already broad. `packages/nexus/src/api/providers.ts` defines provider contracts and `packages/nexus/src/api/ApiVault.ts` stores multiple keys per provider with status, cooldown, failure, latency, and usage metadata. `packages/nexus/src/provider/rotation.ts` supplies round-robin key rotation and fallback predicates. `packages/nexus/src/provider/provider.ts` builds the runtime catalog, merges configured/environment/vault credentials, loads SDK transports, and selects default/fallback models.

Termux-specific code exists in `packages/termux-core` and `packages/termux-api`, including runtime guards, device checks, setup, service management, and low-memory tests. Browser-related handoff and permission logic exists in recent commits, but full autonomous browser execution still needs a dedicated worker/tool boundary. APK testing is not yet a first-class workflow in the terminal runtime.

## Confirmed issues and risks

1. Git patch output needed explicit color disabling. A local fix adding `-c color.ui=false` to `packages/nexus/src/git/index.ts` passed all 9 Git tests under an always-color environment and was published in `nexus-fixed` commit `7bd4693`.
2. The image test fixture is four Base64 characters below the exact expected 5 MiB payload. The production image normalization checks otherwise passed.
3. Root lint/typecheck cannot be treated as a source-level baseline in this sandbox because the TypeScript native preview and tsgolint processes terminate under high memory pressure.
4. `Provider.defaultModel()` returns a configured model whenever its provider exists, without an explicit final credential/route-health check. Auto selection must reject catalog-only or all-cooldown routes.
5. Provider IDs contain compatibility aliases (`gemini`/`google`) and the routing code has separate canonicalization paths. This needs contract tests to prevent selecting a model under a provider ID that has no usable transport/key.
6. The current TUI queue exposes statusline events and an existing `turn.wait` state. An immediate acknowledgement commit is now added locally in `runtime.queue.ts`, but it still needs regression coverage and publication.

## Target architecture

A Master Agent should coordinate typed worker capabilities instead of exposing arbitrary autonomous behavior. Workers should report `planned`, `running`, `waiting`, `blocked`, `completed`, `failed`, or `cancelled` states and persist checkpoints. The Master Agent should select a route only from configured, capable, healthy provider/key/model candidates; classify failures; quarantine only the exact route; and make at most one safe fallback per step before emitting a truthful blocked/error state.

The first implementation slice should harden route eligibility, publish the non-blocking acknowledgement behavior, add state/checkpoint primitives, and then introduce worker contracts for coding, testing, Git, browser, web, and Android/APK operations. Device profiles should control concurrency, context, output limits, cache behavior, and retry budgets rather than changing task semantics.
