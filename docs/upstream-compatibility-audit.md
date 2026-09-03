# NEXUS Upstream OpenCode Compatibility Audit

**Status:** Audit-only maintenance guidance.
**Scope:** Selective compatibility review for the upstream OpenCode `dev` branch.
**Non-goal:** This document neither updates NEXUS nor authorizes automatic upstream merges.

## Evidence baseline

The upstream repository shown on 25 August 2026 uses `dev` as its displayed branch and presents a monorepo layout that includes packages, patches, specifications, contribution guidance, and security material. The displayed head was `a57230b80be1c3bffab71ac021d11b02fb2fbe6c`. This is an observation point for future comparison, not a pinned dependency or a promise that a later upstream commit is compatible with NEXUS. [1]

OpenCode’s official server documentation describes a TUI client communicating with an OpenAPI-backed server. That server surface includes both read-only information endpoints and explicitly mutating configuration, authentication, session, prompt, shell, and TUI-control endpoints. Its user guide also distinguishes planning from building. [2] [3]

> **NEXUS rule:** An upstream endpoint, feature, or implementation pattern is not authorization to perform the related action automatically. Existing NEXUS confirmation, redaction, local-first, and safe-point boundaries continue to govern.

| Audit finding | NEXUS maintenance consequence |
| --- | --- |
| Upstream is actively developed on `dev`, not a frozen compatibility baseline. [1] | Review a specific upstream commit or PR; do not use a blanket sync or unreviewed merge. |
| Upstream separates client presentation from server/API behavior. [2] | Keep NEXUS premium TUI changes and runtime/API changes independently reviewable and testable. |
| Upstream API surface contains both informational and mutating operations. [2] | Classify each candidate change as read-only, local mutation, remote mutation, or credential/account action before implementation. |
| Upstream guidance distinguishes Plan and Build modes. [3] | Preserve NEXUS’s explicit inspection/planning versus action boundaries, especially for shell, model, workspace, and browser flows. |

## Protected NEXUS extension seams

The following areas are product-specific and must not be overwritten merely to match upstream behavior.

| Protected seam | Required preservation rule | Minimum review evidence |
| --- | --- | --- |
| CLI identity and compatibility aliases | Keep `nexus`, `nx`, `devhub`, and `opencode` invocation compatibility intact. | Isolated CLI smoke for every preserved alias. |
| Local API vault | Keep masked storage/output, duplicate safeguards, key-health/cooldown semantics, rotation behavior, and last-key protection. | Vault, rotation, provider-error, and secret-redaction tests. |
| Auto Model and fallback behavior | Preserve manual/current route precedence, capability filtering only for later fallbacks, and local-observed—not provider-account—usage language. | Capability, fallback-order, budget, and session fallback regressions. |
| Premium terminal presentation | Preserve the existing compact footer, truthful activity labels, provider/model redaction, keyboard reachability, and responsive Termux rendering. | Focused TUI/unit tests plus PC and Termux regression at the grouped-program finish. |
| PC and Termux adapters | Preserve command-first ergonomics, DeviceGuard safeguards, local-model no-download/no-runtime guarantees, and explicit Android artifact authorization. | Focused platform tests; never infer GPU, account, quota, or remote-device state. |
| User configuration and project data | Do not rewrite configuration, instructions, workspace state, source files, sessions, or credentials as a side effect of an upstream compatibility review. | Diff review proving no unintended persisted-data change. |

## Selective-update workflow

Every candidate upstream change should begin with a short compatibility record containing the upstream URL, commit SHA, touched upstream paths, intended NEXUS outcome, risk class, and explicit non-goals. The reviewer then classifies the change before any code is copied or adapted.

| Step | Required action | Stop condition |
| --- | --- | --- |
| 1. Observe | Read the specific upstream commit, release note, documentation page, or issue; record its URL and SHA. | The source is unavailable, ambiguous, or unrelated to a defined NEXUS outcome. |
| 2. Classify | Mark the candidate as read-only, local mutation, remote mutation, credential/account, shell, source-write, UI, or platform-adapter work. | More than one risk class is bundled without a reasoned isolation plan. |
| 3. Compare | Identify NEXUS-owned seams affected by the candidate and list the existing tests that protect them. | The candidate would overwrite an extension seam or silently change a preservation rule. |
| 4. Isolate | Adapt only the smallest compatible behavior in a new branch; do not merge upstream history or change dependencies without an approved, separately tested reason. | The adaptation requires a broad sync, unreviewed dependency bump, or opaque generated diff. |
| 5. Validate | Run focused regressions, isolated HOME CLI smoke, secret/safety checks, provider/rotation contracts, typecheck, and whitespace validation. | A required gate fails or validation cannot demonstrate the protected behavior. |
| 6. Merge and record | Merge only after the five mandatory CI gates pass; record the upstream source and preserved boundaries in the roadmap. | Any provider-account, remote/paid, browser/login, destructive, or source-writing action lacks its own explicit safety gate. |

## Explicit abstain conditions

NEXUS must not automatically adopt an upstream change that would add a background daemon, alter user configuration, expose or request credentials in terminal output, manufacture provider quota/balance/cost state, trigger provider requests, install packages, start local-model runtimes, bypass permission prompts, or initiate browser/login/remote actions. Each of those changes needs a separate proposal, explicit safety boundary, focused tests, and the applicable human confirmation flow.

This audit also does not interpret upstream licensing, publish releases, modify dependencies, change installation instructions, or claim that upstream functionality is available on Termux. Those questions require separate source and platform validation.

## References

[1] [OpenCode upstream repository, `dev` branch](https://github.com/anomalyco/opencode)
[2] [OpenCode server documentation](https://opencode.ai/docs/server/)
[3] [OpenCode introduction and Plan/Build guidance](https://opencode.ai/docs/)
