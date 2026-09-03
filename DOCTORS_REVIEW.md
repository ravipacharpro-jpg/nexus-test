# Doctor & Review Agents

## Doctor — Read-only Project Diagnostics

**Description:**  
The Doctor agent performs read-only analysis of NEXUS projects, providing diagnostics with severity levels and secret redaction.

**Severity Levels:**  
- CRITICAL
- HIGH
- MEDIUM
- LOW
- INFO

**Secret Redaction:**  
- GitHub Personal Access Token (PAT)
- OpenAI API key
- OpenRouter API key
- Google API key

**CLI Commands:**
- `nexus autofarm doctor check [--full]` — Run diagnostics on the current project
- `nexus autofarm doctor report [--report PATH]` — Generate a diagnostic report

**Output:**
- `.nexus/doctor-report.md` — Markdown report with findings, severity, and remediation steps

---

## Review — Read-only Code/Diff Review

**Description:**  
The Review agent performs read-only analysis of code diffs and provides approval verdicts.

**Verdicts:**
- APPROVE
- APPROVE-WITH-WARNINGS
- REQUEST-CHANGES
- BLOCKED

**Detected Patterns:**
- Hardcoded secrets (API keys, passwords, tokens)
- `eval()` usage
- `child_process.exec` calls
- Recursive `fs.rm` operations
- `console.log` statements
- TypeScript `any` type usage

**CLI Commands:**
- `nexus autofarm diff-review uncommitted | patch <diff>` — Review uncommitted changes or a specific patch file

**Output:**
- `.nexus/review-report.md` — Markdown report with verdict, findings, and requested changes

---

## Top 3 Best Models (replaces Auto switch)

- `Ctrl+P` → "Top 3 Best" lists three free, fast, currently-available models
- A curated list of 16 best-known free OpenRouter models (Sep 2026) feeds the scoring so NVIDIA Nemotron 3 Ultra (550B), Nemotron 3 Super (120B), Claude Opus 4-8, MiniMax-M3, Qwen 2.5 72B and similar stand out over generic "free-tier" models
- `/top3` slash command and `/vault` slash command for at-a-glance access

---

## Cross-platform

- Pure TypeScript, no native dependencies
- Builds and runs on Termux (Linux aarch64), Linux x86_64, macOS, Windows

## Integration

Both agents are designed to work within the NEXUS ecosystem:

- They generate structured markdown reports stored in `.nexus/`
- CLI commands integrate with the `nexus autofarm` command group
- Reports can be used for audit, compliance, or developer feedback
- Both are read-only — they analyze without modifying project files