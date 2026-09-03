# Nexus Autonomous Agent — Stable Increment

## Release status

This release packages the currently implemented autonomous-agent foundation for terminal-first use on Linux, Termux/Android, and PC environments. It is based on commit `070bdf1` on `main`.

## Included capabilities

Nexus now includes Master-Agent planning and specialist dispatch through the typed worker bridge, dependency-ordered execution, bounded retries, checkpoint and resume behavior, strict verification receipts, capability-aware replanning, and deterministic repair/verification follow-ups for failed or blocked steps.

The release also includes controlled self-improvement proposals, capability registration boundaries, atomic self-update and rollback logic, explicit coder permissions, and terminal status summaries that show active steps, queued instructions, approval states, blocked work, worker progress, verification evidence, changed files, and discovered artifacts.

Browser support includes managed Chromium lifecycle integration with the secure BrowserSession state machine. Sensitive login, password, OTP, CAPTCHA, and approval steps remain takeover-gated and credentials are not extracted or stored by the browser session boundary.

Android support includes APK/AAB artifact planning, connected-device capability detection, and an approval-gated APK command plan for install, launch, and bounded logcat collection. AAB files are not falsely treated as directly installable through adb.

Incident response includes bounded incremental stdout/stderr ingestion, stable fingerprints, severity/source classification, API-key/Bearer/JWT/password/OTP redaction, Termux-aware polling, atomic local report export, and runtime persistence of redacted Master failure evidence. Developer reports require explicit consent and contain anonymized evidence rather than raw user data.

Provider support includes masked multi-key vault rows, no application cap on same-provider keys, unhealthy-key rotation, bounded fallback behavior, offline catalog fallback, compatible text-model selection, and local-only routing/readiness evidence.

## Validation

The serialized stable-release regression suite passed **79 tests across 11 files**, with **0 failures** and **224 assertions**. The suite covered Master orchestration, specialist permissions, incident response, incident watcher lifecycle, BrowserSession, Android planning, self-improvement, API vault and routing behavior, and installation/legacy behavior. Formatting and `git diff --check` also passed.

## Safety and known limits

External mutations remain approval-gated, including sensitive browser actions, Android installation or launch, and remote Git operations. The local incident watcher does not create background work by itself; the runtime must explicitly attach and manage its lifecycle.

Physical Android install, launch, and logcat validation requires a connected adb device or emulator. The current sandbox has no adb binary or connected Android device, so those hardware-dependent checks are represented by tested command plans rather than claimed as physically executed.

The repository-wide typecheck was not used as a release gate because the sandbox has previously terminated the memory-heavy native TypeScript process with SIGBUS/OOM. Focused serialized tests, formatting, and diff checks were used instead. A future release should add chunked or low-memory typecheck execution.

## Upgrade guidance

Use the existing Nexus installation and upgrade commands for the target platform. Before enabling opt-in developer reporting, review the consent configuration and endpoint settings. Test APK execution first on a disposable emulator or isolated device profile.
