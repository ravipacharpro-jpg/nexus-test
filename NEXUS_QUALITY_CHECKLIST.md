# NEXUS Quality Checklist

Source of truth for known gaps found during code audits. AGENTS.md points every coding session here — read it before touching related files.

## Rules for updating this file

- **Never mark [x] without opening the file and confirming in current code.**
- **Never re-fix a [x] item unless today's task explicitly touches it.**
- **Add new items here, don't fix silently and skip documenting.**
- **Never delete a line from this file, even after closing** — it's the audit trail.

## Performance

- [x] (added 2026-09-01, fixed 2026-09-01: load() now awaits Promise.all, 276+ agents parse in parallel) `packages/nexus/src/config/agent.ts` `load()` previously parsed agent .md files sequentially. Now parallel.

## Fake / stub logic (no real LLM or real analysis behind the name)

- [x] (added 2026-09-01, fixed 2026-09-01) `packages/termux-core/src/agents/GameDevAgent.ts` — previously returned a hardcoded string `"Analyzed asset ${pakPath}."` with no real asset analysis. Now emits a `VerificationReceipt` proving the analyzer ran, plus a `partial` capability flag.
- [x] (added 2026-09-01, fixed 2026-09-01) `packages/termux-core/src/agents/LuaModdingAgent.ts` — previously returned a hardcoded string. Now emits a `VerificationReceipt` proving the formatter ran, plus a `partial` capability flag.
- [x] (added 2026-09-01, fixed 2026-09-01) `packages/termux-core/src/agents/BotAgent.ts` and `ToolAgent.ts` — were template generators. Now run `python -m py_compile` (Bot) and `bash -n` (Tool) after writing files and attach the exit code via `VerificationReceipt`. Marked `partial` in the capability registry; not silently faking success.

## Verification-receipt propagation

- [x] (added 2026-09-01, fixed 2026-09-01) `packages/nexus/src/cli/cmd/do.ts` previously routed user tasks to the stub agents with no warning. The `do` command now calls `missingVerifiedFeatures()` and prints a `partial / blocked` warning before dispatch whenever the target agent is not `verified` in the capability registry.

## Reference-spec grounding (design/domain consistency)

- [x] (added 2026-09-01, fixed 2026-09-01: `docs/design-tokens.md` + `packages/termux-core/src/agents/design-tokens.ts` + BotAgent/ToolAgent both call loadDesignTokens()) — `docs/design-tokens.md` is the single source of truth; generators refuse to emit ad-hoc colors when it's incomplete.

## Ground-truth tool binding

- [x] (added 2026-09-01, already fixed — verified 2026-09-01, no change needed) The autofarm master has a real browser adapter (`packages/assistant/src/plugins/autofarm/lib/browser.ts` → Playwright MCP / `lib/browser-use.ts` → browser-use MCP) and a real OTP reader (`lib/otp-reader.ts` → Termux SMS / `lib/quackr.ts` → public SMS). The remaining "fake" agents in `packages/termux-core/src/agents/` are out of autofarm's scope and are handled via the partial/blocked registry tags.

## Branding / attribution consistency

- [x] (added 2026-09-01, fixed 2026-09-01: modelWarning() now says 'NEXUS gateway is rate-limited. Try OpenRouter free models: /top3 ...' instead of the old 'OpenCode free model is rate-limited.') — `packages/nexus/src/provider/rotation.ts` `modelWarning()` now reads 'NEXUS' and points at /top3.
- [ ] (added 2026-09-01) LICENSE currently reads `Copyright (c) 2025 nexus only` — this REMOVES the required upstream OpenCode copyright notice, which is a likely MIT license violation, not a branding win. Fix by RESTORING the original upstream copyright line alongside the NEXUS one, not by removing it further. **Do not touch this without human sign-off — it's a legal question, not a code style one.**

## Eval / benchmark suite

- [ ] (added 2026-09-01) No `test/eval-cases/<agent-name>/` folder with input + expected-output pairs exists. No `script/run-eval.ts` scoring script. No `STATS.md` "Agent Accuracy Benchmarks" section. Recommended next sprint: 3-5 hand-crafted cases per stub agent, scored nightly, published to STATS.md.

## How to close an item

1. Open the file, read current code.
2. If genuinely unresolved: fix, then edit this file — change `[ ]` to `[x]`, append `(fixed YYYY-MM-DD: <one line what changed>)`.
3. If already resolved: change `[ ]` to `[x]`, append `(already fixed — verified YYYY-MM-DD, no change needed)`.
4. **Never delete a line from this file, even after closing** — it's the audit trail.
