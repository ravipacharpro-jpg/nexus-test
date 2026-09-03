# Master Autonomous Agent Architecture

## Purpose

NEXUS will expose one user-facing **Master Agent** in the terminal. The Master Agent owns the task, decomposes it into typed work units, selects the appropriate provider/model route, dispatches worker capabilities, verifies results, persists checkpoints, and reports concise progress without blocking new user instructions.

The user does not need to manage individual workers. Workers are implementation roles behind the Master Agent: `research`, `coder`, `reviewer`, `tester`, `git`, `browser`, `web`, `android`, and `docs`.

## Execution state machine

```text
received
  -> acknowledged
  -> planning
  -> awaiting_approval (only for risky actions)
  -> dispatching
  -> running_worker
  -> verifying
  -> retrying (bounded, same or alternate route)
  -> completed

running_worker -> queued_user_input -> running_worker
running_worker -> paused -> running_worker
running_worker -> blocked
running_worker -> failed
any active state -> cancelled
```

Every transition is persisted with a task ID, parent task ID, worker ID, step ID, route ID, timestamp, redacted summary, and retry count. A process restart reloads the latest atomic checkpoint and resumes only idempotent or explicitly replay-safe steps.

## Master Agent contract

```ts
export type MasterTaskStatus =
  | "received"
  | "acknowledged"
  | "planning"
  | "awaiting_approval"
  | "dispatching"
  | "running"
  | "verifying"
  | "retrying"
  | "paused"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled"

export type WorkerKind =
  | "research"
  | "coder"
  | "reviewer"
  | "tester"
  | "git"
  | "browser"
  | "web"
  | "android"
  | "docs"
```

A worker receives a bounded objective, workspace path, allowed tools, device profile, route requirements, parent task ID, and prior step outputs. It returns a typed result containing status, summary, changed files, verification evidence, next suggestions, and no secrets.

## Non-blocking conversation behavior

The prompt queue acknowledges ordinary user input immediately with a short status such as `Got it — working on it…`, while the Master Agent continues its active run. New instructions are queued and surfaced in the TUI. The coordinator may merge, prioritize, or defer queued instructions only at safe step boundaries. Destructive actions, external messages, account changes, payment, publishing, and Git push remain approval-gated.

## Worker responsibilities

| Worker | Responsibilities | Default tools |
|---|---|---|
| Research | Read project docs, inspect APIs, compare alternatives, summarize evidence | read, search, webfetch |
| Coder | Edit source, add tests, apply patches, preserve formatting | read, write, edit, grep, shell |
| Reviewer | Inspect diffs, security, architecture, regressions, and secret exposure | read, grep, git diff |
| Tester | Run focused tests, builds, lint, typecheck, and reproduce failures | shell, read, test runner |
| Git | Branch, status, diff, commit, fetch, and prepare push/PR | git, shell |
| Browser | Navigate, inspect, click, type, download/upload, and verify browser workflows | browser session, screenshot |
| Web | Start web apps, health-check endpoints, inspect logs, and run UI/API tests | shell, browser |
| Android | Detect Gradle/SDK projects, build APKs, run unit/instrumentation checks, inspect artifacts | shell, adb/emulator when available |
| Docs | Update setup, provider, safety, troubleshooting, and release documentation | read, write, edit |

## Route selection

The Master Agent requests a capability profile before every model call. Auto routing must consider configured credentials, provider/model capability, task type, context size, tool calling, current route health, cooldown, local usage budgets, latency, and device profile. A catalog entry without a configured usable credential is never eligible. Manual model selection remains authoritative.

A provider error is classified into a bounded policy: retry the same route for transient transport failures, quarantine only the exact provider/key/model route for authentication, quota, EOL, or access failures, select at most one compatible fallback for the current step, and otherwise return a truthful blocked result.

## Safety boundaries

The default policy is workspace-scoped. Commands are executed with explicit working directories, bounded output, timeouts, signal forwarding, and redacted environment logging. The following require approval unless a task policy explicitly grants them: deleting outside the workspace, `sudo`, credential access, changing shell profiles, network writes, browser login or personal-data submission, publishing, package releases, Git push, and installing system packages.

## Device profiles

`termux-low`, `termux-standard`, `desktop-standard`, and `desktop-heavy` profiles define memory budget, process concurrency, output limits, timeout, context target, retry budget, and cache strategy. The same task semantics are preserved; only scheduling and resource policy change. If a profile cannot safely execute an APK emulator test, the Android worker returns a precise capability report and runs static/build checks instead.

## Verification contract

A coding task is not complete when files are merely changed. The Master Agent records a verification ladder: formatting, focused unit tests, package tests, typecheck, build, application smoke test, Git diff review, and optional web/APK checks. Failures become new bounded repair steps. The final response includes changed files, commands, pass/fail results, limitations, and whether any external action was skipped.
