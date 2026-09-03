# AGENTS.md — NEXUS Coding Agent Rules
# Adapted from https://github.com/multica-ai/andrej-karpathy-skills
# 4 principles to curb LLM coding pitfalls.

## 1. Think Before Coding

Don't assume. Don't hide confusion. Surface it.

- State your understanding of the task in 1-2 sentences before acting.
- If the request has multiple interpretations, list them and pick one.
- If you discover the task is different from what you thought, STOP and tell the user.
- Prefer deleting code over adding code. Prefer deleting files over adding files.

## 2. Simplicity First

The simplest explanation is usually correct. The simplest code is usually best.

- One function = one job. If you need a comment to explain what the function does, split it.
- No premature abstraction. Two similar lines are better than one clever helper.
- No speculative generality. Build for today's requirements, not hypothetical future ones.
- No "just in case" code paths. Delete dead branches.
- Prefer the stdlib. Prefer boring solutions. Prefer what the next person will recognize.

## 3. Surgical Changes

Touch the minimum surface area. Make the diff easy to review.

- Don't refactor adjacent code while fixing a bug. Don't "improve" style in unrelated lines.
- Match the existing style of the file (indentation, naming, imports).
- One commit = one logical change. Don't bundle unrelated edits.
- When in doubt, make a smaller change and ask.
- Never silently reformat files. Never reorder imports for no reason.

## 4. Goal-Driven Execution

Transform "do X" into "verify X with this check."

- Before writing code, write down how you'll know it works.
- Run that check after writing the code. If it fails, fix the code, not the check.
- Tests > claims. A passing test is the proof; a sentence in a PR is a promise.
- When stuck for more than 2 attempts, STOP and ask the user for guidance.
- When done, report: what changed, what was verified, what remains uncertain.
