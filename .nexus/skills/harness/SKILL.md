---
name: harness
description: DeepSeek Harness plugin architecture patterns ported to NEXUS — everything-is-a-plugin, event-sourced session log, bundle/profile composition, and autonomous demand-driven data-center flow.
---

# Harness — DeepSeek Harness Patterns for NEXUS

Copied from https://github.com/deepseek-ai/deepseek-harness (203k stars) — only the kaam ki cheezein for NEXUS data-center autonomous system.

## What was copied
- `architecture.md` — Cordis plugin tree, profiles/bundles, app launch via `dsh web`
- `cordis-primer.md` — Everything-is-a-plugin + reversible effects
- `event-map.md` — Full event producer/consumer map
- `agent-lifecycle.md` — Turn/step flow with waterfall events

Location: `~/.nexus/skills/harness/`

## How to apply to NEXUS data-center

1. **Plugin tree instead of hard-coded providers**
   - NEXUS `packages/nexus/src/provider/provider.ts` + `rotation.ts` ko Cordis-style Service Definition/Provider/Consumer seam banao
   - Har provider (opencode, openrouter, gmail-farm, quota-monitor) ek plugin — demand pe mount/unmount reversible effect se

2. **Event-sourced session log**
   - `dsh-session` pattern: `session.append(type, data)` -> `deriveMessages()` projection
   - NEXUS `SessionV2` already durable input row rakhta hai — isko append-only log banao, persistence alag plugin (subscribe `session/event` -> flush)

3. **Bundle/Profile composition**
   - `dsh-base` (providers, tools, sandbox) + `dsh-web-app` / `headless` / `sdk` jaise NEXUS ke liye:
     - `nexus-base` (free tier hot + vault warm + gmail cold)
     - `nexus-web` (dashboard), `nexus-headless` (cron pre-warm), `nexus-sdk`
   - `cordis.patch.yml` se live patch — demand ke hisaab se bundle order change without rebuild

4. **Turn flow waterfall**
   - `agent/pre-step -> step/start -> agent/request -> llm/stream -> tools/* -> step/end -> agent/turn-stopping`
   - NEXUS `session/llm.ts:470 attempt()` ke fallback ko is waterfall me daalo — `agent/request` listener me hi 1-retry + suggestion logic lagega, waterfall `next()` se delegate

5. **Demand-driven autonomous pooling**
   - Hot tier: `opencode public / openrouter :free` (daily quota)
   - Warm tier: `ApiVault` verified keys
   - Cold tier: `gmail-farm` pre-warm when `supplyRatio < 0.8`
   - Event `session/event` pe quota-monitor plugin trigger -> cold tier refill before exhaust

## Verify
```bash
ls ~/.nexus/skills/harness/
cat ~/.nexus/skills/harness/architecture.md | head -n 40
```

## Source
- https://github.com/deepseek-ai/deepseek-harness
- Docs: https://deepseek-harness.github.io/deepseek-harness/
