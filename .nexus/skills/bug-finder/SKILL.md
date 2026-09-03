---
name: bug-finder
description: Fast, systematic bug discovery across a codebase. Use when asked to find bugs, investigate failures, hunt regressions, audit error paths, or locate the root cause of a reported issue.
slash: true
---

# Bug Finder

Goal: locate real defects quickly and rank them by impact, without guessing.

## Workflow

1. **Reproduce / scope the symptom.** Capture the exact error, stack trace, inputs, and environment. If the user gave a symptom, ask for the minimal repro before searching blindly.
2. **Static sweep (cheap, high signal).** Prefer the repo's own tooling over memory:
   - `npm run lint` / `npm run typecheck` (or the repo's equivalent) and triage only the warnings tied to the symptom.
   - Targeted `Grep` for high-risk patterns: `TODO`, `FIXME`, `throw new Error(`, `console.error`, `null!`, `as any`, `any`, `parseInt(`, `indexOf(`, `TODO:`, `catch {}`, `Promise.all` with side effects, `useEffect` without deps, unguarded `JSON.parse`, `eval`, `exec(`, `Math.random` in tests.
   - `Glob` to map the affected subsystem before reading files.
3. **Trace the path.** Follow the call chain from the entry point to the failure: input validation → service → IO → return. Identify where the invariant breaks.
4. **Regression hunt (when it used to work).** Use git, not guesswork:
   - `git log --oneline -20 -- <path>` to see recent changes.
   - `git bisect` to pin the breaking commit when the symptom is reproducible.
   - `git log -p -S "<symbol>" -- <path>` to find when behavior changed.
5. **Confirm, don't assume.** Read the actual code at the failure site. A bug report is a hypothesis until the code proves it.
6. **Rank.** Report bugs as: location (`file:line`), root cause, impact, and confidence (high/medium/low). Lead with the highest-impact, highest-confidence item.

## Rules

- Never "fix" while finding unless asked. This skill is for discovery + a short root-cause write-up.
- Cite `file_path:line_number` for every finding so the user can navigate.
- Prefer the repo's existing search tools (Grep/Glob) and build scripts over ad hoc scripts.
- Flag security-sensitive findings (secret logging, unverified downloads, auth gaps) separately and clearly.
- If static analysis is inconclusive, propose an instrumentation step (failing test, log, or trace) before claiming the cause.
