# NEXUS v0.1.71 - "Manus-Style UX Release"

## 🎯 Headline

Manus/Claude-Code style instant acknowledgments. No more "queue pending" popups.

## 🆕 New Features (2 libraries)

### 1. `lib/quick-ack.ts` (227 lines)
- Instant 1-line acknowledgment when user submits a task
- Patterns: `[OK] on it - <task>`, `[+] doing it now: <task>`
- `autoAck(task)` infers ETA from keywords:
  - `search/find` → 5-10s
  - `build/create` → 30-90s
  - `debug/fix` → 1-2min
  - `deploy/publish` → 2-5min
  - `refactor/rewrite` → 5-15min
- Uses priority-router bucket 80 (user) — shows up immediately

### 2. `lib/silent-queue.ts` (200 lines)
- Pending message FIFO with **no display methods**
- `enqueueSilent` / `dequeueSilent` / `drainSilent(worker)`
- `queueStats()` for programmatic monitoring (used by /status)
- `clearSilent()` on agent restart
- **Replaces the old "x messages pending" popup UX**

## 🎯 User Experience

**Before:**
```
User: "Build me a todo app"
... 2-3 min silence ...
[Popup: "5 messages pending in queue"]
```

**After:**
```
User: "Build me a todo app"
Agent: [OK] starting: build me a todo app (ETA 30-90s)  ← INSTANT!
... real work happens silently ...
Agent: Done! Created 5 files: ...
```

## 🐛 Fixes
- Queue UX: removed blocking popup
- Pending messages now silent (track but don't display)

## 📊 Stats
- 2 new lib/ files (~430 lines)
- 0 TUI changes (preserved per user request)
- 0 emoji
- 100% tested (build + runtime)
- 23 + 2 = 25 libraries total

## 🔗 PR
https://github.com/ravipacharpro-jpg/nexus-agent/pull/2

## 📦 All Libraries (25 total)
1. quick-ack (NEW)
2. silent-queue (NEW)
3. hierarchical-memory
4. multi-agent-debate
5. goal-decomposer
6. context-optimizer
7. streaming-buffer
8. auto-skill
9. interruptible-task
10. priority-router
11. short-reply-mode
12. parallel-conversation
13. tool-narrator
14. edit-summary
15. thinking-trace
16. progress-tracker
17. recovery-narrator
18. otp-reader
19. background-daemon
20. parallel-farmer
21. model-selector
22. dual-provider
23. symbolic-chain
24. zero-otp-gmail
25. per-user-vault
