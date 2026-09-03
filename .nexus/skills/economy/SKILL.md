---
name: economy
description: Runtime efficiency policy for the NEXUS agency — pick the smallest capable agent, choose the cheapest sufficient model, cap concurrency, summarize outputs, and fall back on failure. Apply on every multi-step task to keep cost/tokens low without hurting quality.
---

# economy — Smart Runtime Policy

Apply on every task. Goal: maximum outcome per token.

## Rules
1. **Smallest capable agent** — use registry tags to pick the LEAST heavy agent that can do the job. Don't spawn a senior/architect for a trivial edit; use `minimal-change-engineer` / `ponytail` first.
2. **Cost-aware model** — route via OmniRoute variants:
   - heavy codegen / architecture → `auto/coding`
   - trivial / formatting → `auto/cheap` or `auto/fast`
   - exploration / research → `auto/smart`
   - long-context / budget-sensitive → `auto/offline` (most headroom)
3. **Concurrency cap** — on resource-limited hosts (Termux) run at most **3 subagents in parallel**. More is slower, not faster.
4. **Output budget** — before an agent returns to the lead, return a concise result (diffs / links / decisions), not raw dumps. Summarize long outputs.
5. **Fallback chain** — if an agent errors or stalls, retry once with another agent sharing the same tag; if still failing, escalate to the human checkpoint.
6. **No duplicate work** — check registry/memory before spawning; reuse prior results.

## Result
The agency runs like a paid team: right agent, right model, right parallelism — minimal tokens, maximal throughput.
