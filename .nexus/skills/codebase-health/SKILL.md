---
name: codebase-health
description: Periodic or pre-merge codebase health check — lint, typecheck, tests, dead-code removal, dependency/pattern updates, and a stability report. Keeps the project professional, bug-free, and cruft-free.
---

# Codebase Health

Run this to keep the codebase professional, stable, and bug-free — continuously
or before any merge/release.

## Steps

1. **Static gates**
   ```bash
   npm run lint && npx tsc --noEmit && npm test
   ```
   Zero errors is the bar. Fix all warnings.

2. **Dead-code & cruft scan**
   - Search for unused exports, orphan files, commented-out blocks, duplicate
     helpers.
   - Remove them (deletion over addition).

3. **Update outdated**
   - `npm outdated` → safe bumps; note breaking changes.
   - Replace deprecated APIs / patterns with current ones in place.

4. **Lean pass (ponytail)** — apply the YAGNI ladder; reduce where possible
   without changing behavior.

5. **Verify**
   - Re-run lint + tests.
   - If UI changed: open it with the `playwright` browser tool, screenshot, check
     console for errors. Hand to `reality-checker` / `ui-finish-gate-reviewer`
     for an independent verdict.

6. **Report** — what was removed, updated, and any risk. Use the `notify` skill
   to ping the user on completion or if a human decision is needed.

## Integrate

- The `maintainer` agent owns this loop. The `orchestrator` invokes it after any
  code change and before declaring done.
- Schedule it (cron/scheduler) for recurring health passes on long-lived repos.

Never call work "done" until lint + tests are green and the visual/functional
check passes.
