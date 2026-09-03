# NEXUS Fully Autonomous Master Agent — Complete Implementation Checklist

## 1. Final Definition of “Fully Autonomous”

NEXUS ko fully autonomous tab maana jayega jab user sirf natural-language objective de aur Master Agent khud repository/project samjhe, plan banaye, required specialist workers select kare, code ya project create kare, tests/builds run kare, failures diagnose kare, safe repairs kare, evidence collect kare, aur final result de. User ko har file, command, worker, model, test, ya retry manually coordinate na karna pade.

Autonomy ka matlab unsafe ya impossible action ko blindly execute karna nahi hai. Login, CAPTCHA/2FA, secret entry, personal data, payment, production mutation, public publishing, commit/push/PR, aur external submissions approval-gated rahenge. Unsupported SDK, unavailable device, provider quota, ya missing permission ko agent clearly report karega.

## 2. Master Brain and Task Lifecycle

| #    | Required work                     | Done condition                                                                                                                |
| ---- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | Natural-language objective parser | Bug fix, new app, refactor, research, testing, APK, GitHub, and docs intent correctly classified                              |
| 2.2  | Workspace/project resolver        | Correct repository, directory, branch, monorepo package, or new-project location selected                                     |
| 2.3  | Task risk classifier              | Read-only, local mutation, external mutation, authentication, secret, and destructive risk levels separated                   |
| 2.4  | Capability planner                | Required runtime, package manager, browser, SDK, device, provider, and permissions detected before execution                  |
| 2.5  | Dependency graph planner          | Research, implementation, review, tests, docs, and Git steps run in valid order                                               |
| 2.6  | Dynamic replanning                | Failed, blocked, or newly discovered work updates the plan without losing completed steps                                     |
| 2.7  | Master state machine              | received → acknowledged → planning → dispatching → running → verifying → retrying → completed/blocked/failed states persisted |
| 2.8  | Durable checkpoint                | Crash, Termux interruption, terminal close, or process kill ke baad task safe paused state se resume ho                       |
| 2.9  | Idempotent resume                 | Completed steps unnecessarily repeat na hon; partial steps safely revalidated hon                                             |
| 2.10 | User instruction queue            | Active task ke beech new instruction immediately acknowledge aur safely queue ho                                              |
| 2.11 | Cancellation                      | User cancel par child workers, processes, browser sessions, and pending network work cleanly stop hon                         |
| 2.12 | Final response synthesizer        | Changes, tests, failures, skipped capabilities, artifacts, approvals, and next actions clearly summarize hon                  |

## 3. Real Worker Orchestration

| #    | Required work                 | Done condition                                                                                   |
| ---- | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| 3.1  | Typed MasterWorkerRegistry    | Har worker fixed request/result contract use kare; arbitrary commands directly accept na kare    |
| 3.2  | Worker capability matrix      | Worker sirf detected device/runtime capabilities ke baad dispatch ho                             |
| 3.3  | Worker lifecycle events       | queued, started, running, waiting, retrying, blocked, completed, failed states stream hon        |
| 3.4  | Worker timeout policy         | Har worker ka bounded timeout aur cancellation signal ho                                         |
| 3.5  | Worker retry policy           | Retry sirf retryable failure par ho; max attempts aur backoff enforce ho                         |
| 3.6  | Worker evidence contract      | Summary, exit status, changed files, logs, screenshots, artifacts, and verification attached hon |
| 3.7  | Worker dependency enforcement | Dependent worker previous success ke baghair execute na ho                                       |
| 3.8  | Worker isolation              | Coder, tester, browser, GitHub, and Android actions separate safety adapters se run hon          |
| 3.9  | Worker result validator       | Worker “success” tabhi report kare jab expected evidence present ho                              |
| 3.10 | Parallelism policy            | PC par safe parallel tasks; Termux par mostly sequential low-memory tasks                        |

## 4. Specialist Agents

### 4.1 Research Worker

Repository structure, README, issue history, framework docs, API documentation, package metadata, and known failures inspect kare. Research findings ko sources/evidence ke saath checkpoint kare. Unsupported assumptions ko fact ke taur par report na kare.

### 4.2 Planner Worker

Large objective ko small executable steps mein break kare. Acceptance criteria, dependencies, risks, affected files, required tools, expected tests, rollback plan, and final artifacts define kare.

### 4.3 Coder Worker

Existing coding style follow kare, smallest safe patch banaye, unrelated files modify na kare, tests saath add/update kare, secrets commit na kare, aur generated output ko source code samajh kar overwrite na kare.

### 4.4 Debugger Worker

Bug reproduce kare, logs/state inspect kare, root cause identify kare, symptom-only patch avoid kare, minimal fix apply kare, aur regression test add kare. “Unable to reproduce” ko failure evidence ke saath report kare.

### 4.5 Reviewer Worker

Diff correctness, security, compatibility, API contracts, error handling, resource cleanup, platform behavior, and test quality review kare. Reviewer ko patch reject ya changes request karne ka typed result dena chahiye.

### 4.6 Tester Worker

Focused unit tests, integration tests, typecheck, lint, build, smoke tests, project-specific tests, and device tests correct order mein run kare. First failing test ko primary failure mark kare aur unrelated failures ko separately report kare.

### 4.7 Documentation Worker

README, setup, usage, configuration, API, architecture, changelog, troubleshooting, limitations, and release notes update kare. User-facing docs mein unsupported capabilities ko overclaim na kare.

### 4.8 Git/GitHub Worker

Status, diff, branch, history, CI, issues, releases, and PR metadata inspect kare. Commit, push, PR creation, issue comment, merge, release, and deployment explicit approval ke baad hi kare.

## 5. Bug-Fixing Pipeline

1. User objective receive aur acknowledge karo.
2. Correct workspace, branch, project type, package manager, and runtime detect karo.
3. Existing tests and reproduction command locate karo.
4. Bug ko smallest reliable reproduction mein convert karo.
5. Logs, stack trace, relevant source, recent diff, and environment inspect karo.
6. Root-cause hypothesis likho aur competing hypotheses eliminate karo.
7. Minimal code fix apply karo.
8. New regression test add karo.
9. Targeted test run karo.
10. Related tests, lint, typecheck, and build run karo.
11. Failure aaye to first cause isolate karke bounded repair karo.
12. Diff/security review complete karo.
13. Artifacts and evidence checkpoint karo.
14. User ko fix, verification, limitations, and optional approval action report karo.

## 6. New Project and App Creation Pipeline

### 6.1 Requirements and Design

Natural-language idea ko requirements, users, workflows, data model, APIs, screens, CLI commands, permissions, and acceptance criteria mein convert karo. Ambiguous details par safe defaults choose karo, lekin architecture-changing ambiguity ko checkpoint karo.

### 6.2 Project Type Detection

Web app, backend/API, CLI, desktop app, mobile/Expo app, Android native/APK, agent, library, automation script, documentation project, or monorepo package identify karo.

### 6.3 Scaffold Selection

Correct framework/template choose karo. Existing repository ho to preserve architecture. New project ho to minimal stable scaffold, package manager lockfile, environment template, README, test setup, lint/typecheck, and Git ignore create karo.

### 6.4 Implementation

Master relevant coder worker ko dispatch kare. Feature ko vertical slices mein implement kare: data/API, core logic, UI/CLI, validation, errors, tests, and docs.

### 6.5 Local Run and Verification

Dev server, API server, CLI command, mobile build, or APK build bounded process supervisor ke through start ho. Health check, smoke test, focused tests, build artifacts, and cleanup verify hon.

### 6.6 Delivery

Source diff, run instructions, test results, build artifact path, environment requirements, known limitations, and approval-required next steps provide hon.

## 7. Web App and Backend Capability

| #    | Required work             | Done condition                                                                                  |
| ---- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| 7.1  | Package manager detection | Bun, npm, pnpm, yarn, and fallback behavior correct                                             |
| 7.2  | Framework detection       | Vite, React, Next, Svelte, Angular, Expo, Express, Fastify, and unknown Node targets identified |
| 7.3  | Dependency validation     | Missing dependency, lockfile mismatch, and install requirement reported safely                  |
| 7.4  | Dev server start          | Fixed executable/arguments, bounded timeout, process group, and cleanup                         |
| 7.5  | Port management           | Available port choose ho, existing process detect ho, orphan process clean ho                   |
| 7.6  | Health checks             | Localhost HTTP status, expected page/API response, and timeout evidence                         |
| 7.7  | Test/build commands       | Only allowlisted scripts run; first failure captured                                            |
| 7.8  | API smoke tests           | Health, auth boundary, validation, error, and core endpoint checks                              |
| 7.9  | Frontend smoke tests      | Page load, console errors, critical interaction, and asset loading checks                       |
| 7.10 | Artifact capture          | Logs, screenshots, build output, and server URL checkpointed                                    |

## 8. Browser Automation

### Safe automatic actions

Public HTTP(S) page inspection, title/text/status extraction, safe URL validation, page evidence, local browser capability detection, and explicit browser handoff implement karo.

### Approval-gated actions

Login, personal information entry, secret/API-key entry, cookies/session use, file upload, form submission, sending messages, purchase/payment, account changes, public posting, and deployment approval ke baghair nahi honge.

### Required browser improvements

1. Playwright/browser-engine adapter with capability detection.
2. Page navigation timeout and cancellation.
3. Screenshot and DOM/text evidence capture.
4. Download path isolation and file-type validation.
5. Domain allowlist/denylist and sensitive-query blocking.
6. Session isolation and cookie redaction.
7. No CAPTCHA/2FA bypass; user takeover route.
8. Browser crash recovery and cleanup.
9. Deterministic mock browser tests.
10. Real PC and Termux browser handoff smoke tests.

## 9. Git and GitHub Lifecycle

| Operation                       |           Automatic? | Requirement                                     |
| ------------------------------- | -------------------: | ----------------------------------------------- |
| `git status`, branch, diff, log |                  Yes | Fixed read-only adapter                         |
| Local test/build/lint           |                  Yes | Allowlisted project command and bounded process |
| Create local patch              |                  Yes | Workspace permission and checkpoint             |
| Create local commit             | Approval recommended | User confirmation or configured trusted mode    |
| `git push`                      |        No by default | Explicit confirmation                           |
| Create PR                       |        No by default | Explicit confirmation and review evidence       |
| Comment on issue/PR             |        No by default | Explicit confirmation                           |
| Merge/release/deploy            |                   No | Explicit confirmation and production checks     |
| GitHub metadata/CI inspection   | Yes if authenticated | Read-only `gh` adapter and redaction            |

Required implementation includes branch strategy, dirty-worktree protection, secret scanning, diff summary, conflict detection, CI status polling without infinite loops, PR evidence, and rollback guidance.

## 10. Android/APK and Termux

| #     | Required work             | Done condition                                                                |
| ----- | ------------------------- | ----------------------------------------------------------------------------- |
| 10.1  | Android project detection | Gradle wrapper/build files/settings detected                                  |
| 10.2  | Gradle wrapper selection  | `gradlew`/`gradlew.bat` platform-correct invocation                           |
| 10.3  | SDK capability report     | SDK, build-tools, platform, Java, Gradle, and wrapper availability listed     |
| 10.4  | Unit tests                | `./gradlew test` run with bounded output                                      |
| 10.5  | Lint/static checks        | `./gradlew lint` or detected equivalent run                                   |
| 10.6  | APK build                 | Debug/release build only when toolchain exists                                |
| 10.7  | APK artifact discovery    | APK path, size, variant, and checksum reported                                |
| 10.8  | Device detection          | `adb get-state` confirms actual connected device                              |
| 10.9  | Connected tests           | `connectedCheck` only with confirmed device/emulator                          |
| 10.10 | Emulator honesty          | No emulator claim when device/SDK unavailable                                 |
| 10.11 | Signing boundary          | Release signing keys never generated/exposed automatically                    |
| 10.12 | Termux limits             | No emulator assumption; low-memory sequential profile; clear install guidance |

## 11. Self-Debugging and Repair Engine

1. Every command ka exit code, stdout, stderr, duration, and signal capture karo.
2. Output cap enforce karo, lekin complete logs artifact file mein preserve karo.
3. Error categories define karo: syntax, type, dependency, test assertion, timeout, network, auth, permission, resource, device, and unknown.
4. Stack traces ko source locations se map karo.
5. First failing root cause ko downstream cascade errors se separate karo.
6. Repair hypothesis generate karo.
7. Patch scope limit karo.
8. Repair se pehle checkpoint lo.
9. Repair ke baad exact regression rerun karo.
10. Max retry count, total time budget, and repair count enforce karo.
11. Repeated same failure par loop stop karo.
12. Successful repair ke baad new regression test persist karo.
13. Failed repair par workspace restore/rollback option do.
14. Final result mein attempted repairs and unresolved failures list karo.

## 12. Verification and Quality Gates

A task ko complete mark karne se pehle relevant gates select hon:

- Source parses successfully.
- Targeted unit tests pass.
- Regression test pass.
- Integration/smoke test pass.
- Lint pass.
- Typecheck pass or documented environment limitation.
- Build pass.
- Artifact exists and is readable.
- No secret or sensitive data leaked.
- No orphan process remains.
- Git diff expected scope mein hai.
- Approval-gated operations were not silently performed.
- Evidence checkpoint persisted.

## 13. Security and Safety

| Area             | Required protection                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Secrets          | Vault encryption/masking, no logs, no prompts in public output, no commits               |
| Paths            | Workspace boundary, traversal prevention, symlink policy, temp isolation                 |
| Commands         | Fixed executable/argument adapters, allowlists, no arbitrary shell from worker contracts |
| Browser          | HTTPS/HTTP validation, sensitive query block, cookie/secret redaction, no CAPTCHA bypass |
| Git              | Dirty-worktree warning, branch awareness, push/PR approval, secret scan                  |
| Network          | Timeouts, cancellation, domain policy, no unbounded crawling                             |
| Files            | Size/type limits, backup before destructive mutation, artifact quarantine                |
| Auth             | User takeover for login, personal information, API keys, CAPTCHA/2FA                     |
| External actions | Explicit approval token, action preview, final confirmation, audit record                |
| Recovery         | Atomic checkpoints, rollback metadata, corruption guard                                  |

## 14. Provider and Auto Model System

1. Same provider ki many API keys add karne ki no artificial cap.
2. Key status: active, invalid, rate-limited, suspended, cooling-down, unknown.
3. Exact provider+key+model route health track karo.
4. Task capability requirements: text, tools, vision, reasoning, long context, JSON, audio.
5. Manual model choice ko silent auto-switch se protect karo.
6. Auto mode mein configured usable keys only select karo.
7. Retry-After parse karo.
8. Same-provider key rotation bounded rakho.
9. One compatible fallback choose karo; infinite fallback loops nahi.
10. No eligible route par truthful error and user action do.
11. Provider catalog connected/unconnected labels ke saath show karo.
12. API key never appears in status, logs, screenshots, or worker evidence.
13. Fast acknowledgement model work se separate UI path mein do.

## 15. Termux/Android and PC Resource Controls

| #     | Required work             | Done condition                                                     |
| ----- | ------------------------- | ------------------------------------------------------------------ |
| 15.1  | Device profile            | Termux fast, desktop balanced, powerful PC deep profile            |
| 15.2  | Memory budget             | Worker concurrency/output/cache limits profile-based               |
| 15.3  | Process group             | Child process and descendants cleanup                              |
| 15.4  | Signal escalation         | SIGTERM then bounded SIGKILL; Windows equivalent handling          |
| 15.5  | Temp cleanup              | Per-task temp directory and finally cleanup                        |
| 15.6  | Output limit              | In-memory cap and artifact file fallback                           |
| 15.7  | Network timeout           | Every external request cancellable and bounded                     |
| 15.8  | Offline mode              | Read-only/local tasks continue when network/provider unavailable   |
| 15.9  | Battery/thermal awareness | Termux avoids emulator/heavy parallel work by default              |
| 15.10 | Resume after Android kill | Checkpoint survives process death and resumes safely               |
| 15.11 | Cross-platform paths      | Windows separators, executable suffixes, shell differences handled |
| 15.12 | Long-task UX              | User ko continuous short status without blocking prompt milta rahe |

## 16. TUI Requirements

1. Master mode clearly visible.
2. Current objective and active step visible.
3. Active worker name and status visible.
4. Retry count and elapsed time visible.
5. Queue panel mein pending instructions visible.
6. Checkpoint/resume state visible.
7. Provider/model/Auto status visible.
8. Capability warnings visible.
9. Approval preview dialog visible.
10. Cancel, pause, resume, retry, and inspect-evidence controls available.
11. Long output collapsible/truncated ho.
12. Fast acknowledgement immediately render ho.
13. Errors user-friendly hon; raw stack trace optional evidence panel mein ho.
14. Termux narrow terminal layout stable ho.
15. Existing keybindings and configured default agent preserve hon.

## 17. Testing Matrix

### Automated tests

- Master plan/dependency/retry/checkpoint tests.
- Worker registry contract tests.
- Browser safety and public inspection tests.
- Web project detection and command allowlist tests.
- Android no-SDK/no-device/device-present mocked tests.
- Git/GitHub read-only and approval tests.
- Provider multi-key/fallback/quarantine tests.
- Enter/queue/interrupt tests.
- TUI state rendering tests.
- Path traversal/secret redaction/security tests.
- Process cleanup and timeout tests.

### Platform tests

| Platform       | Minimum validation                                                     |
| -------------- | ---------------------------------------------------------------------- |
| Linux PC       | Full unit/integration/lint/typecheck/build smoke                       |
| Windows PC     | PowerShell/cmd, `gradlew.bat`, path, signal, browser smoke             |
| macOS PC       | shell/path/browser handoff and project smoke                           |
| Termux         | low-memory profile, package manager, Git, Node/Bun, local project test |
| Android device | adb detection, APK install/test only when explicitly available         |
| Emulator       | only when SDK/emulator actually installed; never assumed               |

## 18. Release Checklist

- [ ] Master dispatches real typed workers from live SessionPrompt.
- [ ] Existing normal agent/session path remains compatible.
- [ ] Coder/debugger/reviewer/tester/research/docs workers are live, not placeholders.
- [ ] Web app can be started, health-checked, tested, and stopped safely.
- [ ] Browser evidence and approval gates work.
- [ ] Git/GitHub read-only inspection and approved mutation flow work.
- [ ] Android/APK build and no-device fallback work.
- [ ] Verification evidence is persisted and resumable.
- [ ] Self-repair loop is bounded and regression-protected.
- [ ] TUI shows worker/checkpoint/provider state.
- [ ] Termux profile avoids unsafe heavy tasks.
- [ ] Same-provider many-key vault and Auto Model fallback pass.
- [ ] Security/redaction suite passes.
- [ ] Linux/Windows/macOS/Termux smoke checks pass.
- [ ] Full workspace typecheck passes on a sufficiently resourced machine.
- [ ] CI workflow is present and has permission to run.
- [ ] Release docs, limitations, and rollback instructions are complete.

## 19. Current NEXUS Position

Implemented foundation: Master lifecycle/checkpoint/retry, fast acknowledgements, multi-key provider routing, device profiles, typed capability-aware workers, safe browser HTTP inspection, bounded project checks, read-only Git/GitHub inspection, Android connected-device gating, Enter reliability, image-fixture repair, TUI Master/provider/model indicators, and deterministic SessionPrompt regression fixtures.

Still required for the true final target: live Master worker dispatch from SessionPrompt, real LLM-backed coder/debugger/reviewer/tester/research/docs workers, complete web-app lifecycle, richer browser engine adapter, full evidence store, comprehensive self-repair loop, full TUI task controls, cross-platform integration validation, and a production CI/release matrix.
