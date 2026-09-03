---
name: repo-manager
description: Repository hygiene and management. Use when asked to clean up a repo, manage branches, prune merged/stale branches, audit history for secrets, sync remotes/forks, tag releases, or prepare the repo for shipping.
slash: true
---

# Repo Manager

Goal: keep the repository clean, safe, and releasable.

## Capabilities

### Branch hygiene
- List branches with last-commit age: `git branch -v` + `git for-each-ref --sort=committerdate`.
- Identify merged branches: `git branch --merged <base>` and propose deleting those not matching protected names (main, master, develop, release/*).
- Flag stale branches (no commits in N days) for review before deletion.
- Never delete protected or unmerged branches without explicit confirmation.

### Cleanup
- Show untracked + ignored build artifacts: `git status --short`, `git clean -ndx` (dry-run first).
- Remove only generated files (dist, node_modules caches, .turbo, coverage) — never source. Use `git clean -fdx` only after the user confirms the dry-run list.
- Detect large files that bloat the repo: `git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | awk '/^blob/ && $3 > 1048576'`.

### Secret audit
- Scan history for leaked credentials: `git log -p -S` for `api_key`, `token`, `secret`, `password`, `BEGIN PRIVATE KEY`, `ghp_`, `sk-`, `AKIA`.
- If a secret is found in history, flag it as HIGH severity: rotate the credential immediately and scrub history (filter-repo / BFG) before any push.
- Also scan the working tree (including `.env`) with Grep; ensure `.gitignore` covers secrets.

### Remote / fork sync
- Show remotes: `git remote -v`. For a fork, fetch upstream and report divergence: `git fetch upstream && git rev-list --left-right --count HEAD...upstream/main`.
- Propose a fast-forward or rebase plan; never force-push to shared branches without consent.

### Releases
- List tags: `git tag --sort=-creatordate | head`. Recommend semantic version bumps based on the diff scope (patch/minor/major).
- Stage only intended files; verify `git status` and `git diff --cached` before any commit.

## Rules

- Dry-run every destructive command (`git clean -ndx`, `git branch -d` on merged-only, `git clean -fdx`) and show the list before executing.
- Confirm before deleting branches, tags, or running force operations.
- Treat any discovered secret as an incident: report, rotate, scrub — do not just delete the file.
- Respect `.gitignore` and protected branches; do not rewrite shared history unilaterally.
