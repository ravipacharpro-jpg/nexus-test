# NEXUS Master Agent Guide

The `master` agent is the autonomous primary coordinator for multi-step coding and project tasks. It can plan work, use the existing terminal/file/Git tools, delegate specialist work through the existing task tool, verify changes, retry bounded failures, and leave resumable checkpoints. The TUI emits a short acknowledgement as soon as a prompt enters the queue, so long-running work does not make the interface appear frozen.

## Agent selection

The Master Agent is the default primary mode. An explicit agent selection remains supported, so existing workflows can continue to use `build`, `plan`, `explore`, or a configured custom agent. The Master Agent prompt instructs the model to prefer small reversible changes, inspect diffs, run focused verification, and report failures honestly.

## Provider keys and model catalog

The API vault accepts multiple keys for the same provider without an application-imposed count limit. Keys are stored locally, masked in public rows, and tracked independently for status, failures, cooldowns, and latency. A rate-limited key is temporarily skipped while other healthy keys remain eligible; an expired cooldown makes the key eligible again.

The provider selector displays the supported catalog independently from credential state. A provider can therefore be visible before its key is configured. Visibility does not imply usability: Auto routing only selects a route when the provider/key is configured, the model is compatible with the task, and the route is not invalid, deprecated, suspended, or cooling down.

Provider quotas remain controlled by each provider. NEXUS supports unlimited key entries and honest route rotation, but it cannot remove a provider's free-tier quota or rate limit.

## Enter and multiline input

Plain `Return` and `Enter` submit a prompt. Modified Return combinations such as `Shift+Return`, `Ctrl+Return`, `Alt+Return`, and platform Meta/Super combinations remain available for multiline input. The run composer includes a direct fallback for terminal environments that do not emit the underlying textarea submit event.

## Device-aware profiles

When no explicit profile is saved, NEXUS detects Termux/Android markers and uses the conservative `fast` profile. Desktop systems use `balanced` by default and use `deep` only on machines with a large memory and CPU budget. Users can override this with `nexus profile set fast`, `nexus profile set balanced`, `nexus profile set deep`, or `nexus profile set local`.

The device profile controls parallel task limits, output budgets, network preference, and model preference. Termux should use sequential or low-parallel work for large repositories and Android builds. The PC profile can safely use more concurrency when system resources permit.

## Safety boundaries

The Master Agent may inspect, edit, test, and review project files according to the configured permissions. Destructive filesystem operations, secret handling, login or personal-data submission, package publishing, Git pushes, and other irreversible external actions must remain behind an approval boundary. API keys, tokens, cookies, and raw sensitive environment values must never be printed in logs or final summaries.

## Validation ladder

A coding task should finish with formatting, focused tests, package tests, typecheck where memory permits, build or smoke checks, and a final Git diff review. On constrained devices, the runtime should reduce concurrency and use focused checks rather than launching every workspace task at once.
