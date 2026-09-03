---
name: bug-fixer
description: Structured bug-fixing workflow. Use when asked to fix a bug, patch a defect, resolve a reported issue, or implement a regression test after a root cause is known.
slash: true
---

# Bug Fixer

Goal: fix the root cause with a minimal, convention-following change and prevent recurrence.

## Workflow

1. **Reproduce first.** Write or run a failing test that exercises the bug. If no test framework is set up, create the smallest repro script. A fix without a repro is a guess.
2. **Locate the root cause.** Use the findings from the `bug-finder` skill (or the user's report) and read the exact code at `file:line`. Confirm the invariant that is violated.
3. **Minimal fix.** Change only what is needed. Match the surrounding style:
   - Mirror nearby patterns for error handling, logging, and control flow.
   - Reuse existing utilities/helpers instead of inventing new ones.
   - Do not introduce `any`, non-null assertions, or unchecked casts to satisfy the type checker.
4. **Guard the edge cases.** Handle the inputs that triggered the bug (empty, null, undefined, out-of-range, concurrent, unauthorized). Add explicit validation where the contract was implicit.
5. **Add a regression test.** Encode the failing case so it cannot silently return. Keep it focused and fast.
6. **Verify.** Run `npm run lint`, `npm run typecheck`, and the relevant test(s). If the repo lacks a runner, at least run the repro from step 1 and confirm it now passes.
7. **Report.** Summarize: what broke, why, the change (`file:line`), and the test that guards it. Keep it to a few lines unless asked for detail.

## Rules

- Fix the cause, not the symptom. Patching a crash with a `try/catch` that swallows the error hides bugs.
- Never weaken types or tests to make a fix "pass".
- Respect the repo's permission/security model (no logging of secrets, no unverified remote execution).
- If the fix is risky or touches shared APIs, call out the blast radius and suggest a reviewer.
