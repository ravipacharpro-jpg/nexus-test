---
name: sop
description: Standard operating procedure for end-to-end delivery — intake, plan (via Orchestrator), build with specialist subagents, verify (codebase-health + reality-check + UI gate), and notify. This is the default playbook for all non-trivial work.
---

# SOP — Standard Operating Procedure

Follow this for every real task. It keeps work professional, stable, and autonomous
without skipping safety.

## 1. Intake
- Read `memory/USER.md` first (stack, URLs, preferences) so you don't re-ask.
- Clarify only genuine ambiguities; otherwise assume sensible defaults.

## 2. Plan
- Run the **Orchestrator** subagent to decompose the goal and assign specialists.
- Note the human checkpoints (login / OTP / CAPTCHA / payment) up front.

## 3. Build (autonomous)
- Delegate each step to the assigned specialist subagent.
- Use MCP/browser tools as planned (`playwright`, `github`, `firebase`,
  `supabase`, `cpanel`).
- Keep changes lean (ponytail: delete over add).

## 4. Verify (mandatory gate)
- Run **codebase-health**: lint + typecheck + tests must be green.
- UI work: open with `playwright`, screenshot, no console errors.
- Hand to `reality-checker` and `ui-finish-gate-reviewer` for an independent
  verdict. A red gate blocks "done".

## 5. Notify
- Use the `notify` skill to ping the user on completion, and at any human
  checkpoint.

## 6. Hand off / escalate
- Only escalate to the user for: login, OTP, CAPTCHA, payment, or an explicit
  approval. Everything else finishes autonomously.
- Log what worked/failed so the system self-improves over time.

Nothing is "done" until step 4 is green.
