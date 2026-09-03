# Doctor Report

- **Generated**: 2026-09-02T10:34:31.122Z
- **Repo**: `/data/data/com.termux/files/home/nexus-agent`
- **Version**: v0.1.73

## Summary

| Severity | Count |
|----------|------:|
| CRITICAL | 5 |
| HIGH     | 0 |
| MEDIUM   | 0 |
| LOW      | 1 |
| INFO     | 2 |
| **Total**| **8** |

## Findings

### [CRITICAL] Hardcoded GitHub personal access token in source

- **Category**: security
- **Status**: confirmed
- **Impact**: Secret committed to git history. Rotate immediately.
- **Evidence**: `packages/assistant/src/core/redact.test.ts: ghp_AbCdEfGh…`
- **Reproduce**: `grep -rn 'ghp_[a-z' packages/assistant/src/core/redact.test.ts`
- **Recommendation**: Move to ~/.nexus/api-vault.json, rotate the key, and amend history.
- **Auto-fix safe**: no

### [CRITICAL] Hardcoded OpenAI API key in source

- **Category**: security
- **Status**: confirmed
- **Impact**: Secret committed to git history. Rotate immediately.
- **Evidence**: `packages/assistant/src/plugins/autofarm/index.ts: sk-test12345…`
- **Reproduce**: `grep -rn 'sk-[a-zA' packages/assistant/src/plugins/autofarm/index.ts`
- **Recommendation**: Move to ~/.nexus/api-vault.json, rotate the key, and amend history.
- **Auto-fix safe**: no

### [CRITICAL] Hardcoded GitHub personal access token in source

- **Category**: security
- **Status**: confirmed
- **Impact**: Secret committed to git history. Rotate immediately.
- **Evidence**: `packages/assistant/test/doctor-review.test.ts: ghp_ABCDEFGH…`
- **Reproduce**: `grep -rn 'ghp_[a-z' packages/assistant/test/doctor-review.test.ts`
- **Recommendation**: Move to ~/.nexus/api-vault.json, rotate the key, and amend history.
- **Auto-fix safe**: no

### [CRITICAL] Hardcoded OpenAI API key in source

- **Category**: security
- **Status**: confirmed
- **Impact**: Secret committed to git history. Rotate immediately.
- **Evidence**: `packages/http-recorder/test/record-replay.test.ts: sk-123456789…`
- **Reproduce**: `grep -rn 'sk-[a-zA' packages/http-recorder/test/record-replay.test.ts`
- **Recommendation**: Move to ~/.nexus/api-vault.json, rotate the key, and amend history.
- **Auto-fix safe**: no

### [CRITICAL] Hardcoded Google API key in source

- **Category**: security
- **Status**: confirmed
- **Impact**: Secret committed to git history. Rotate immediately.
- **Evidence**: `packages/http-recorder/test/record-replay.test.ts: AIzaSyDHibiB…`
- **Reproduce**: `grep -rn 'AIza[a-z' packages/http-recorder/test/record-replay.test.ts`
- **Recommendation**: Move to ~/.nexus/api-vault.json, rotate the key, and amend history.
- **Auto-fix safe**: no

### [LOW] 175 TODO/FIXME comment(s) in source

- **Category**: code-hygiene
- **Status**: confirmed
- **Impact**: Pending work tracked in code rather than issues.
- **Reproduce**: `grep -rn 'TODO\|FIXME' packages/ | wc -l`
- **Recommendation**: Convert to issues or address in upcoming commits.
- **Auto-fix safe**: no

### [INFO] 3 uncommitted change(s)

- **Category**: git
- **Status**: confirmed
- **Impact**: Local changes exist that are not yet committed.
- **Evidence**: ` M VERSION
 M package.json
 M packages/assistant/src/plugins/autofarm/lib/partial-features.ts`
- **Reproduce**: `git status`
- **Recommendation**: Review and commit or stash as appropriate.
- **Auto-fix safe**: no

### [INFO] bun test not runnable in this environment

- **Category**: testing
- **Status**: not-tested
- **Impact**: Automated tests cannot execute; rely on smoke-test.sh.
- **Evidence**: `bun test --version failed`
- **Reproduce**: `bun test --version`
- **Recommendation**: Either fix deps or maintain a shell-based smoke check.
- **Auto-fix safe**: no

---
*Doctor is read-only. No files were modified, no packages installed, no commits made.*