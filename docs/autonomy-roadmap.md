# NEXUS Master Agent — 100% Practical Autonomy Roadmap

## Goal

NEXUS ko terminal-first **Master Autonomous Agent** banana hai jo Termux/Android aur PC par ek hi user-facing Master mode se task ko samjhe, plan banaye, specialist workers ko dispatch kare, code aur files modify kare, tests/builds run kare, failures diagnose kare, bounded repair kare, aur verified evidence ke saath result de.

"100% autonomous" ka practical matlab yahan yeh hai ke normal coding, debugging, testing, web-app, Git, documentation, aur APK workflows user ko har chhote step par manually coordinate na karne padhein. Provider quota, operating-system permissions, CAPTCHA/2FA, login secrets, aur destructive external submissions ko bypass karna possible ya safe target nahi hai.

## Current Foundation

NEXUS mein Master task lifecycle, checkpoint/resume, dependency-aware plan execution, bounded retries, queue acknowledgements, multi-key provider vault, health-aware Auto Model fallback, Termux/PC profiles, typed worker registry, safe public HTTP inspection, bounded project checks, read-only Git/GitHub inspection, Android connected-device gating, Enter submission reliability, image-fixture repair, aur TUI Master/provider/model indicators implemented hain.

## Remaining Implementation Layers

| Priority | Layer                   | Kya implement karna hai                                                                                                                             | Completion proof                                                                 |
| -------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| P0       | Live Master dispatcher  | SessionPrompt se Master task create/resume ho, plan execute ho, worker events stream hon, aur normal assistant stream duplicate na ho               | End-to-end test: one prompt → plan → workers → final verified response           |
| P0       | Specialist LLM workers  | Coder, debugger, reviewer, tester, researcher, aur docs workers ko existing TaskTool/subagent runtime se typed requests ke through connect karna    | Mocked worker dispatch plus real local-provider integration test                 |
| P0       | Failure/recovery loop   | Error classify, first failing command isolate, minimal patch apply, focused test rerun, max retry budget, final evidence                            | Tests proving no infinite retry and failed task checkpoint remains resumable     |
| P0       | Verification gate       | Code task tab tak complete na ho jab tak focused tests, type/lint/build ya documented limitation complete na ho                                     | WorkerResult mein commands, exit codes, changed files, and evidence persisted    |
| P1       | Web-app lifecycle       | Project detect, package manager select, dependency check, dev server start, localhost health check, browser/page evidence, test/build cleanup       | Temporary web fixture end-to-end lifecycle test with timeout and process cleanup |
| P1       | Browser worker          | Safe navigation/inspect, page text/title/status/screenshot evidence, browser-engine capability detection, session handoff                           | Public page test plus explicit login/upload/submit approval tests                |
| P1       | Git/GitHub lifecycle    | Status/diff/branch/log/CI/issue/PR read-only inspection; approval-gated commit, push, branch, PR, issue comments                                    | Mocked GitHub CLI tests, redaction tests, approval denial tests                  |
| P1       | Android/APK lifecycle   | Gradle wrapper detection, unit/build/lint, APK artifact discovery, signing boundary, adb/device test only when connected                            | Mocked no-SDK/no-device matrix plus real device validation when available        |
| P1       | Artifact/evidence store | Logs, diffs, screenshots, APK paths, test reports, model route, retries, and checkpoint IDs linked to the task                                      | Resume task can reconstruct what ran and why                                     |
| P1       | TUI observability       | Active worker, step, retry, elapsed time, queued instructions, checkpoint state, approval prompt, failure summary, cancel/resume controls           | TUI state tests and manual terminal smoke test                                   |
| P2       | Resource supervision    | Process groups, SIGTERM/SIGKILL escalation, bounded stdout/stderr, temp cleanup, sequential Termux tests, memory-aware concurrency                  | Termux profile tests and orphan-process regression tests                         |
| P2       | Provider resilience     | Per-provider/per-key/per-model health, Retry-After, exact-route quarantine, one compatible fallback, manual-model immunity, truthful no-route state | Existing Auto Model/quarantine suites plus provider fault matrix                 |
| P2       | Security boundary       | Secret redaction, workspace boundary, path traversal defense, command allowlists, approval tokens, audit log, no arbitrary browser submission       | Security regression suite with malicious paths/URLs/commands                     |
| P2       | Offline/degraded mode   | Explain missing provider/tool/device capability, continue read-only analysis where possible, never pretend unsupported work completed               | Capability matrix tests on Termux and PC-like environments                       |
| P3       | Cross-platform release  | Linux, Windows, macOS, Termux shell differences; wrapper executables; signals; path/quoting; actual Android device matrix                           | CI matrix plus real Termux/Windows smoke runs                                    |

## Master Execution Flow

1. **Receive:** User prompt ko immediately acknowledge karo aur active task ko queue/checkpoint karo.
2. **Understand:** Objective, workspace, device profile, provider route, required capabilities, risk level, aur expected artifacts identify karo.
3. **Plan:** Research → implementation → review → test → documentation/Git steps ko dependency graph mein convert karo.
4. **Dispatch:** Har step ko typed worker request do; worker arbitrary command nahi bana sakta, sirf approved capability adapter use karega.
5. **Stream:** TUI ko short status updates do; detailed evidence task checkpoint mein save karo.
6. **Verify:** Exit codes, changed files, test/build output, browser evidence, and artifact existence check karo.
7. **Repair:** Failure par first failing cause isolate karo, bounded minimal repair karo, phir focused verification rerun karo.
8. **Approve:** Commit/push/PR, login, upload, payment, personal-data access, and external submission se pehle explicit approval lo.
9. **Finish:** Final response mein completed work, tests, artifacts, skipped capabilities, and remaining risks clearly report karo.
10. **Resume:** Crash/Termux interruption ke baad checkpoint se safe paused state mein resume karo; completed steps repeat na karo jab tak required na ho.

## Specialist Responsibilities

| Specialist    | Responsibility                                                                           |
| ------------- | ---------------------------------------------------------------------------------------- |
| Researcher    | Repository/docs/API investigation; claims and constraints with sources/evidence          |
| Planner       | Dependency graph, risk classification, task decomposition, acceptance criteria           |
| Coder         | Minimal code changes, preserve existing behavior, add focused tests                      |
| Debugger      | Reproduce failure, inspect logs/state, identify root cause, propose smallest safe repair |
| Reviewer      | Diff/security/API/compatibility review; reject unverified or over-broad changes          |
| Tester        | Focused unit/integration/device tests, failure triage, regression evidence               |
| Git/GitHub    | Read-only repository/CI/issue/PR inspection; mutations only after approval               |
| Browser       | Public safe inspection and approved browser handoff; no CAPTCHA/2FA bypass               |
| Web           | Package/project detection, bounded dev server and localhost health/test lifecycle        |
| Android/APK   | Gradle/APK/lint/unit/connected checks based on detected SDK/device capabilities          |
| Documentation | README, changelog, architecture, usage, limitations, and release evidence                |

## Safety and Honesty Boundary

> Agent ko unsupported capability ko successful report nahi karna. Agar Android SDK, device, browser engine, provider key, login, ya permission missing ho to exact limitation aur next safe action report karna hai.

External destructive actions—`git push`, PR creation, issue comments, deployment, account login, file upload, payment, production mutation, or personal-data access—approval token ke baghair execute nahi honge. CAPTCHA/2FA ko automate ya bypass nahi kiya jayega. API-key entries app mein bohat saari ho sakti hain, lekin provider quota/rate limits unlimited nahi ban sakti.

## Validation Standard

A release ko practical-complete tab maana jayega jab focused tests green hon, worker evidence persisted ho, no-route and unavailable-device cases truthful hon, processes cleanup hon, TUI status visible ho, and Linux/Windows/macOS/Termux smoke checks complete hon. Current sandbox memory limitation ki wajah se full workspace typecheck ko separately run karna hoga; targeted lint/tests ko full CI ka replacement claim nahi kiya jayega.
