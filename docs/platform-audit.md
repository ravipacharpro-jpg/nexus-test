# NEXUS PC + Termux Platform Audit

## Purpose

NEXUS should remain a **local-first, command-first agent platform** that feels coherent on both PC and native Termux. Its differentiator is not a larger checklist of remote integrations. It is the combination of safe local workflows, truthful device-aware behavior, flexible model/provider choices, and a premium desktop/TUI experience that does not hide what is happening.

This audit is grounded in the implemented local reliability policy and the Auto Model/API vault policy. It deliberately separates capabilities that are already dependable from aspirational remote, browser, or always-on workflows that require explicit user control.[1] [2]

## Current Platform Position

| Area | Retain as a product strength | Operating boundary |
|---|---|---|
| PC workflow | Full CLI/TUI, project workspace discovery, local diagnostics, code, Git, recovery, and manual-review flows. | Do not redesign the current premium interface merely to expose more controls. |
| Termux workflow | Native command guards, Termux:API checks, device/battery/network protection, actionable setup failures, and ARM64-aware local-model guidance. | Never promise Android background survival, root access, or unavailable API results. |
| Model choice | Manual selection is first-class; Auto Model only considers configured healthy compatible routes. | Do not guess provider balance, account ownership, quota, or cost. |
| API vault | Multiple distinct keys, masked state, explicit validation, cooldown/rotation safety, and local observed usage caps. | Do not merge different keys as one upstream account without authorized evidence. |
| Agent safety | Bounded context, local permission layers, Voice authentication-factor blocking, and confirmation before mutation. | No raw secret, OTP, password, session, or API-key flow through UI, logs, prompts, or model context. |

> **Product rule:** When NEXUS cannot verify a platform capability locally, it must say what is missing and give the next safe user action. It must not simulate success.

## Priority Roadmap

| Priority | Work | Why it matters | Guardrail |
|---|---|---|---|
| P0 | Consolidated PC + Termux regression gate before the next broad release. | Recent provider, Auto, workspace, permission, voice, and context changes need one realistic compatibility pass. | Do not request fragmented contributor retests; use one evidence-driven final checklist. |
| P0 | Keep factual activity state and interruption checkpoints consistent across desktop and Termux. | Users need to know whether NEXUS is working, retrying, awaiting approval, or safely idle. | Never invent task progress, provider health, or completed work. |
| P1 | Extend local project workflows through explicit manual-review artifacts and confirmation-gated changes. | Workspace and Translator flows already support safe inspection; the next value is clearer review rather than automatic editing. | No shell-directory switching, source mutation, or model transformation without an explicit separate action. |
| P1 | Improve first-run simplification around `nexus onboard`, Ctrl+P API setup, `nexus doctor`, profiles, and a small test task. | New users should reach a truthful working state without learning every command first. | Preserve command-first Termux use and manual provider/model control. |
| P2 | Optional gateway schedules, shared memory, hosted operation, Firebase, cPanel, deployment, and browser co-pilot modules. | These can be valuable for advanced users but are not core local runtime needs. | Disabled by default; explicit identity/authorization; human confirmation for remote or sensitive actions. |

## Recommended PC Experience

PC should be the place where users can comfortably inspect projects, model choices, agent roles, permissions, diffs, and manual-review reports. The default journey should remain simple:

1. Run `nexus onboard` or `nexus doctor` to understand runtime, providers, and device status.
2. Add or inspect masked API keys using Ctrl+P or `nexus api`; select **Auto** or keep a manual model choice.
3. Start with a small task, then use the factual active-session status rather than generic spinners.
4. For project work, inspect `nexus workspace list`, `show`, or a manually saved local bookmark; generate Translator plans/reports before attempting any code transformation.
5. Use Git/recovery/manual review features before a confirmed mutation.

The desktop UI should add contextual detail only when it is backed by a factual local state: current route, local cap decision, permission waiting state, explicit review artifact, or real error. Decorative provider quota, cost, or unverified “AI thinking” information should remain excluded.[2]

## Recommended Termux Experience

Termux must stay compact and keyboard-first. The best experience is a short install path, clear prerequisite checks, useful failures, and conservative workload behavior:

1. Use the official Termux:API package/app only for commands that need Android integrations; explain missing command or permission prerequisites directly.
2. Prefer `nexus doctor`, `nexus models local`, and profiles before heavy local model downloads or long tasks.
3. Respect battery, thermal, metered-network, and wake-lock constraints; treat notifications and boot helpers as best effort only.
4. Keep copy-only workspace navigation and local bookmarks distinct from changing a shell directory or active session.
5. Keep microphone/Voice flows optional and block authentication-factor-like speech before it is displayed or routed.

The product should not emulate a desktop browser inside Termux, promise daemon-like persistence, or imply that Termux has GPU/VRAM support that has not been detected.[1]

## Deliberate Non-Goals

The following remain deliberately outside default NEXUS behavior:

- Silent credential import, browser-session reuse, password/OTP/CAPTCHA handling, or secret forwarding.
- Automatic payment, government-form, hosting, deployment, Firebase production, or cPanel mutation.
- Hidden background daemons, automatic boot activation, or promises of Android process survival.
- Guessed provider balance, free quota, model availability, account identity, or cost estimates.
- Broad UI replacement that sacrifices the established desktop/TUI identity or Termux command ergonomics.

## Decision Criteria for Future Work

Every candidate feature should pass these questions before implementation:

| Question | Required answer |
|---|---|
| Does it preserve aliases, user data, API vault rotation, manual model choice, and existing command behavior? | Yes, with targeted regression coverage. |
| Can it run locally without an external account? | Preferably; otherwise it must be optional and explicitly configured. |
| Does it mutate local source, a remote system, a browser session, or a credential store? | If yes, require a narrow confirmation and a reviewable preview. |
| Can the user understand its actual status from facts already observed? | Yes; otherwise expose an actionable unknown/unavailable state. |
| Does it help both PC and Termux, or is it safely platform-gated? | It must be one of these; do not blur platform boundaries. |

## References

[1] [NEXUS Reliability Audit](./reliability-audit.md)

[2] [NEXUS Auto Model and API Vault Policy](./auto-model-and-api-vault-policy.md)
